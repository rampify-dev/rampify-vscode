import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RampifyApiClient } from '../api/client';
import { Session } from '../auth/session';
import { getProjectConfig } from '../utils/project-config';
import { projectDisplayName, primaryProject } from '../utils/project-display';
import { execFile } from 'child_process';
import { projectAnswered, sidebarSteps, stepDone, type ProjectType, type SidebarStep, type StartingPoint } from './setup-steps';
import { AI_TOOL_LABELS, chosenAiTool, type AiTool } from '../mcp/connect';

/**
 * What the Home panel shows: where this folder is in getting set up. Loaded
 * independently of the specs tree (which only fetches while visible), so the
 * panel can tell when the first spec lands and hand over to the tree.
 */
export interface SetupSnapshot {
  hasFolder: boolean;
  signedIn: boolean;
  /** Signed in through OAuth for this folder's project (vs a pasted API key). */
  viaSignIn: boolean;
  clientId: string | null;
  /** projects.id (the /sites/:id API id). */
  siteId: string | null;
  projectName: string | null;
  /** The open folder's name: the default project name. */
  folderName: string | null;
  /** The project's setup answers, as saved. */
  project: ProjectAnswers | null;
  /** The project questions still need answering (sidebar step "Your project"). */
  needsProjectSetup: boolean;
  /** Site scan: none yet, running, finished (pages found), or failed. */
  scan: 'none' | 'running' | 'done' | 'failed';
  gsc: { connected: boolean; hasProperty: boolean };
  /** Rampify's MCP server is in this folder's (or Cursor's) MCP config. */
  mcpConfigured: boolean;
  /**
   * An AI tool has actually connected to Rampify over MCP (server-reported).
   * Null when the server doesn't say; the checklist falls back to mcpConfigured.
   */
  aiToolConnected: boolean | null;
  specCount: number;
  /** The getting-started spec (spec a3f4b733), once created. */
  gettingStarted: { id: string; title: string; status: string; tasks: { id: string; title: string; status: string }[] } | null;
  /** The spec the user's AI wrote from it ("what you're working on"). */
  followUp: { id: string; title: string; status: string } | null;
  /** The user's own specs (not the getting-started spec, not scan specs). */
  userSpecCount: number;
  /** Specs Rampify's site scans filed. */
  scanSpecCount: number;
  /** The folder has commits (null = couldn't tell). No commits → ask what they're building. */
  hasCommits: boolean | null;
  /** Where prompts go: the AI tool the user connected (or the editor's own). */
  aiTool: AiTool;
  aiToolLabel: string;
  /** Steps the user chose "Skip for now" on, for this folder's project. */
  skipped: SidebarStep[];
  /** Couldn't reach Rampify or the project. */
  error: string | null;
}

export interface ProjectAnswers {
  name: string | null;
  type: ProjectType | null;
  startingPoint: StartingPoint | null;
  domain: string | null;
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

  /** Skip a step for this folder's project, or bring it back. */
  async setSkipped(step: SidebarStep, skipped: boolean): Promise<void> {
    const key = `${SKIPPED_KEY}.${this.snapshot.clientId ?? 'none'}`;
    const current = new Set(this.workspaceState.get<SidebarStep[]>(key) ?? []);
    if (skipped) { current.add(step); } else { current.delete(step); }
    await this.workspaceState.update(key, [...current]);
    await this.refresh();
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
   */
  get currentView(): SidebarView {
    const override = this.workspaceState.get<SidebarView>(VIEW_KEY);
    if (override) { return override; }
    const s = this.snapshot;
    if (!s.signedIn || !s.clientId) { return 'home'; }
    const ids = sidebarSteps(s.needsProjectSetup ? null : s.project?.type ?? null, s.needsProjectSetup ? null : s.project?.startingPoint ?? null);
    const settled = ids.every((id) => stepDone(id, s) || s.skipped.includes(id));
    return settled || (s.userSpecCount > 0 && !s.gettingStarted) ? 'specs' : 'home';
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
  refresh(opts: { background?: boolean } = {}): Promise<void> {
    if (!this.loading) {
      this.loading = this.load(opts.background ?? false).finally(() => { this.loading = undefined; });
    }
    return this.loading;
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
    next.skipped = this.workspaceState.get<SidebarStep[]>(`${SKIPPED_KEY}.${next.clientId ?? 'none'}`) ?? [];
    next.aiTool = chosenAiTool(this.workspaceState);
    next.aiToolLabel = AI_TOOL_LABELS[next.aiTool];

    if (next.signedIn && next.clientId) {
      const api = this.getApiClient().withTrigger(background ? 'background' : 'user');
      try {
        const clients = await api.getClients({ silent: true });
        const client = clients.find((c) => c.id === next.clientId);
        next.projectName = client ? projectDisplayName(client) : null;
        const site = await api.getSite(next.clientId, { silent: true });
        next.siteId = site?.id ?? null;
        const setup = site ? await api.getSetup(site.id) : null;
        if (setup) {
          const p = setup.project;
          next.project = { name: p.name, type: p.project_type, startingPoint: p.starting_point, domain: p.domain };
          // Answered in the sidebar or on the web, or the web wizard was finished.
          next.needsProjectSetup = !(projectAnswered(p.project_type, p.starting_point) || setup.wizard?.state === 'completed');
          next.scan = setup.bootstrap_phase === 'crawling'
            ? 'running'
            : setup.has_crawled_urls ? 'done' : setup.bootstrap_phase === 'crawl_failed' ? 'failed' : 'none';
          next.gsc = { connected: setup.gsc.connected, hasProperty: setup.gsc.has_property };
        } else {
          // Older server: fall back to "has a site".
          next.needsProjectSetup = !(site?.domain || (client && primaryProject(client)?.domain));
        }
        next.specCount = site ? await api.countFeatureSpecs(site.id) : 0;
        const gs = site ? await api.getGettingStarted(site.id) : null;
        if (gs) {
          next.gettingStarted = gs.getting_started;
          next.followUp = gs.follow_up;
          next.userSpecCount = gs.user_spec_count;
          next.scanSpecCount = gs.scan_spec_count;
        } else {
          // Older server: treat every spec as the user's.
          next.userSpecCount = next.specCount;
        }
        next.hasCommits = await folderHasCommits();
        next.aiToolConnected = await api.getAiToolConnected();
        if (!client) {
          next.error = "This folder's project isn't available with your current sign-in.";
        }
      } catch {
        next.error = "Couldn't reach Rampify. Check your connection, then refresh.";
      }
    }

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
    projectName: null, folderName: null, project: null, needsProjectSetup: false,
    scan: 'none', gsc: { connected: false, hasProperty: false },
    mcpConfigured: false, aiToolConnected: null, specCount: 0, skipped: [], error: null,
    gettingStarted: null, followUp: null, userSpecCount: 0, scanSpecCount: 0, hasCommits: null,
    aiTool: 'copilot', aiToolLabel: AI_TOOL_LABELS.copilot,
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
