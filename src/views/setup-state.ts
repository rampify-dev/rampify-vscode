import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RampifyApiClient, type ProjectSetup } from '../api/client';
import { Session } from '../auth/session';
import { getProjectConfig } from '../utils/project-config';
import { projectDisplayName, primaryProject } from '../utils/project-display';
import { execFile } from 'child_process';
import { setupSettled, stepInputs, type SidebarStep } from './setup-steps';
import type { ProjectAnswers, SetupSnapshot, SignInPhase } from './setup-snapshot';
import { AI_TOOL_LABELS, chosenAiTool, copilotMcpSupported, editorKind, pickedAiTool, type AiTool } from '../mcp/connect';

export type { ProjectAnswers, SetupSnapshot } from './setup-snapshot';

/**
 * How long a just-started scan shows as running before the job has marked it
 * (a few seconds, normally). Short, so a scan that fails at once (robots.txt,
 * a site that doesn't answer) shows its failure soon after.
 */
const SCAN_START_GRACE_MS = 20_000;

/**
 * The site's scan, from the server: running while the job runs, else the
 * site's state (site_state(), the one definition). Older servers without
 * `onboarding`: from the crawl fields.
 */
function scanOf(setup: ProjectSetup): SetupSnapshot['scan'] {
  if (setup.bootstrap_phase === 'crawling') { return 'running'; }
  const site = setup.onboarding?.facts.siteState;
  if (site) { return site === 'scanned' ? 'done' : site === 'crawl_failed' ? 'failed' : 'none'; }
  return setup.has_crawled_urls ? 'done' : setup.bootstrap_phase === 'crawl_failed' ? 'failed' : 'none';
}

const MCP_DONE_KEY = 'rampify.mcpSetupDone';
const SKIPPED_KEY = 'rampify.skippedSteps';
const VIEW_KEY = 'rampify.viewOverride';

/** Which sidebar view shows: the setup checklist or the specs list. */
export type SidebarView = 'home' | 'specs';

export class SetupState implements vscode.Disposable {
  private snapshot: SetupSnapshot = emptySnapshot();
  private readonly emitter = new vscode.EventEmitter<SetupSnapshot>();
  readonly onDidChange = this.emitter.event;
  private loading: Promise<void> | undefined;
  private scanStartedAt = 0;
  private signInPhase: SignInPhase = 'idle';

  constructor(
    private readonly getApiClient: () => RampifyApiClient,
    private readonly session: Session,
    private readonly workspaceState: vscode.Memento
  ) {}

  get current(): SetupSnapshot {
    return this.snapshot;
  }

  /** This folder's extension state (per-workspace memento). */
  get memento(): vscode.Memento {
    return this.workspaceState;
  }

  /**
   * Skip a step, or bring it back. Onboarding skips are stored on the server
   * (Search Console and the first playbook per project, "how did you find us"
   * per person), so the web
   * and the AI tool see them too; "Your first spec" is this machine's.
   */
  /** Skip or un-skip a step. False when the server didn't take it. */
  async setSkipped(step: SidebarStep, skipped: boolean): Promise<boolean> {
    const api = this.getApiClient();
    let ok = true;
    if ((step === 'search_console' || step === 'first_playbook') && this.snapshot.siteId) {
      ok = await api.setOnboardingStepSkipped(this.snapshot.siteId, step, skipped);
    } else if (step === 'how_found') {
      // Skipping is final (it records that they were asked), as on the web.
      if (skipped) { ok = await api.saveHowFound(null); }
    } else if (step === 'first_spec') {
      await this.workspaceState.update(`${SKIPPED_KEY}.${this.snapshot.clientId ?? 'none'}`, skipped ? ['first_spec'] : []);
    }
    await this.refresh();
    return ok;
  }

  /**
   * A scan was just started. The job marks the project as scanning a few
   * seconds later, so until it does (at most SCAN_START_GRACE_MS) the sidebar
   * shows it running rather than the old result.
   */
  scanStarted(): void {
    this.scanStartedAt = Date.now();
  }

  /**
   * Show the checklist or the specs list. By default the specs list takes over
   * once the project has specs; "Show specs" / "Setup checklist" override it
   * for this folder.
   */
  async showView(view: SidebarView | null): Promise<void> {
    await this.workspaceState.update(VIEW_KEY, view ?? undefined);
    this.applyView();
  }

  /**
   * The view the sidebar is showing: the user's choice, else the specs list
   * once setup is settled (every step done or skipped), or for people who
   * already had their own specs before onboarding existed. Scan specs never
   * switch it, so a scan mid-onboarding doesn't take over the sidebar.
   * Signed out, it's always Home (the sign-in panel), whatever was chosen.
   */
  get currentView(): SidebarView {
    // The session, not the snapshot: a load that started before sign-out
    // still carries signedIn: true.
    if (!this.session.isSignedIn) { return 'home'; }
    const s = this.snapshot;
    const override = this.workspaceState.get<SidebarView>(VIEW_KEY);
    if (override) { return override; }
    if (!s.clientId) { return 'home'; }
    return setupSettled(stepInputs(s)) || (s.userSpecCount > 0 && !s.gettingStarted) ? 'specs' : 'home';
  }

  private applyView(): void {
    vscode.commands.executeCommand('setContext', 'rampify.view', this.currentView);
    vscode.commands.executeCommand('setContext', 'rampify.hasSpecs', this.snapshot.specCount > 0);
  }

  /** Mark the MCP step done (the wizard ran in this folder). */
  async markMcpSetupDone(): Promise<void> {
    await this.workspaceState.update(MCP_DONE_KEY, true);
    await this.refresh();
  }

  /**
   * Re-read everything; concurrent calls share one load. `background` marks
   * loads the extension starts on its own (polling, focus), not a click.
   */
  refresh(opts: { background?: boolean; fresh?: boolean } = {}): Promise<void> {
    // `fresh`: a load already running may have started before what the
    // caller just changed (a sign-in linking the folder): run another after it.
    if (opts.fresh && this.loading) {
      const after = this.loading.then(() => this.refresh({ background: opts.background }));
      return after;
    }
    if (!this.loading) {
      this.loading = this.load(opts.background ?? false).finally(() => { this.loading = undefined; });
    }
    return this.loading;
  }

  /** Show a sign-in's progress (it outlives reloads until it's over). */
  setSignInPhase(phase: SignInPhase): void {
    if (this.signInPhase === phase) { return; }
    this.signInPhase = phase;
    this.snapshot = { ...this.snapshot, signInPhase: phase };
    this.applyView();
    this.emitter.fire(this.snapshot);
  }

  private async load(background: boolean): Promise<void> {
    const next = emptySnapshot();
    const folder = vscode.workspace.workspaceFolders?.[0];
    next.hasFolder = !!folder;
    next.folderName = folder?.name ?? null;
    next.signedIn = this.session.isSignedIn;
    next.viaSignIn = this.session.hasProjectToken;
    next.clientId = getProjectConfig()?.clientId ?? null;
    next.mcpConfigured = !!this.workspaceState.get<boolean>(MCP_DONE_KEY) || detectMcpConfig();
    next.firstSpecSkipped = (this.workspaceState.get<SidebarStep[]>(`${SKIPPED_KEY}.${next.clientId ?? 'none'}`) ?? []).includes('first_spec');
    next.aiTool = chosenAiTool(this.workspaceState);
    next.aiToolLabel = AI_TOOL_LABELS[next.aiTool];

    next.editor = editorKind();
    next.copilotReady = copilotMcpSupported();
    next.pickedAiTool = pickedAiTool(this.workspaceState, next.clientId);

    if (next.signedIn && next.clientId) {
      const api = this.getApiClient().withTrigger(background ? 'background' : 'user');
      try {
        // Two waves of requests in parallel, not one after another: what
        // needs only the folder's project, then what needs its site.
        const [clients, site, hasCommits, aiToolConnected] = await Promise.all([
          api.getClients({ silent: true }),
          api.getSite(next.clientId, { silent: true }),
          folderHasCommits(),
          api.getAiToolConnected(),
        ]);
        const client = clients.find((c) => c.id === next.clientId);
        next.projectName = client ? projectDisplayName(client) : null;
        next.siteId = site?.id ?? null;
        next.hasCommits = hasCommits;
        next.aiToolConnected = aiToolConnected;
        const [setup, specCount, gs] = site
          ? await Promise.all([api.getSetup(site.id), api.countFeatureSpecs(site.id), api.getGettingStarted(site.id)])
          : [null, 0, null];
        const prev = this.snapshot;
        if (setup) {
          const p = setup.project;
          next.project = { name: p.name, domain: p.domain };
          next.onboarding = setup.onboarding ?? null;
          next.howFoundOptions = setup.how_found_options ?? [];
          next.scanFailure = setup.scan_failure ?? null;
          next.firstPrompt = setup.first_prompt ?? null;
          next.firstPlaybook = setup.first_playbook ?? null;
          next.scan = scanOf(setup);
          next.gsc = { connected: setup.gsc.connected, hasProperty: setup.gsc.has_property };
          if (next.scan === 'running') { this.scanStartedAt = 0; }
          if (next.scan !== 'running' && Date.now() - this.scanStartedAt < SCAN_START_GRACE_MS) {
            next.scan = 'running';
            next.scanFailure = null;
          }
        } else if (site && prev.siteId === site.id && prev.project) {
          // A request that failed (timeout, 5xx): keep what we last knew
          // rather than shrinking the checklist to the older-server fallback.
          next.project = prev.project;
          next.onboarding = prev.onboarding;
          next.howFoundOptions = prev.howFoundOptions;
          next.scanFailure = prev.scanFailure;
          next.firstPrompt = prev.firstPrompt;
          next.firstPlaybook = prev.firstPlaybook;
          next.scan = prev.scan;
          next.gsc = prev.gsc;
        } else {
          // Older server: the site from the project list.
          const domain = site?.domain ?? (client ? primaryProject(client)?.domain : null) ?? null;
          next.project = { name: null, domain };
        }
        next.specCount = specCount;
        if (gs) {
          next.gettingStarted = gs.getting_started;
          next.followUp = gs.follow_up;
          next.userSpecCount = gs.user_spec_count;
          next.scanSpecCount = gs.scan_spec_count;
        } else {
          // Older server: treat every spec as the user's.
          next.userSpecCount = next.specCount;
        }
        if (!client) {
          next.error = "This folder's project isn't available with your current sign-in.";
        }
      } catch {
        next.error = "Couldn't reach Rampify. Check your connection, then refresh.";
      }
    }

    // The phase as it is now, not when this load started.
    next.signInPhase = this.signInPhase;
    this.snapshot = next;
    this.applyView();
    this.emitter.fire(next);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function emptySnapshot(): SetupSnapshot {
  return {
    hasFolder: false, signedIn: false, viaSignIn: false, clientId: null, siteId: null,
    projectName: null, folderName: null, project: null, onboarding: null, howFoundOptions: [], scanFailure: null,
    scan: 'none', gsc: { connected: false, hasProperty: false },
    mcpConfigured: false, aiToolConnected: null, specCount: 0, firstSpecSkipped: false, error: null,
    gettingStarted: null, followUp: null, userSpecCount: 0, scanSpecCount: 0, hasCommits: null,
    aiTool: 'copilot', aiToolLabel: AI_TOOL_LABELS.copilot,
    signInPhase: 'idle', editor: 'other', copilotReady: false, pickedAiTool: null, firstPrompt: null, firstPlaybook: null,
  };
}

/** Whether the open folder's git repo has any commits (null: not a repo / no git). */
function folderHasCommits(): Promise<boolean | null> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) { return Promise.resolve(null); }
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd, timeout: 3000 }, (err, stdout) => {
      if (!err) { resolve(stdout.trim().length > 0); return; }
      // Exit 1 with --quiet: a repo with no commits yet. Anything else: unknown.
      resolve((err as unknown as { code?: number | string }).code === 1 ? false : null);
    });
  });
}

/**
 * Best-effort check that some AI tool on this machine has Rampify's MCP server
 * configured: the project's .vscode/.cursor/.mcp.json files, plus Cursor's and
 * Claude Code's user-level config. OAuth installs from the dashboard name the
 * server "Rampify", the wizard "rampify"; both point at /api/mcp.
 */
function detectMcpConfig(): boolean {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const candidates = [
    folder && path.join(folder, '.vscode', 'mcp.json'),
    folder && path.join(folder, '.cursor', 'mcp.json'),
    folder && path.join(folder, '.mcp.json'),
    path.join(os.homedir(), '.cursor', 'mcp.json'),
    path.join(os.homedir(), '.claude.json'),
  ].filter((p): p is string => !!p);
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      if (/rampify\.dev\/api\/mcp|localhost:\d+\/api\/mcp/i.test(text)) { return true; }
    } catch {
      // Missing or unreadable: not configured there.
    }
  }
  return false;
}
