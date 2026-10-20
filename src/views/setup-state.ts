import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RampifyApiClient } from '../api/client';
import { Session } from '../auth/session';
import { getProjectConfig } from '../utils/project-config';
import { projectDisplayName, primaryProject } from '../utils/project-display';
import { projectAnswered, type ProjectType, type SidebarStep, type StartingPoint } from './setup-steps';

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

  /** The view the sidebar is showing (an override, else specs once there are any). */
  get currentView(): SidebarView {
    return this.workspaceState.get<SidebarView>(VIEW_KEY) ?? (this.snapshot.specCount > 0 ? 'specs' : 'home');
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

  /** Re-read everything; concurrent calls share one load. */
  refresh(): Promise<void> {
    if (!this.loading) {
      this.loading = this.load().finally(() => { this.loading = undefined; });
    }
    return this.loading;
  }

  private async load(): Promise<void> {
    const next = emptySnapshot();
    const folder = vscode.workspace.workspaceFolders?.[0];
    next.hasFolder = !!folder;
    next.folderName = folder?.name ?? null;
    next.signedIn = this.session.isSignedIn;
    next.viaSignIn = this.session.hasProjectToken;
    next.clientId = getProjectConfig()?.clientId ?? null;
    next.mcpConfigured = !!this.workspaceState.get<boolean>(MCP_DONE_KEY) || detectMcpConfig();
    next.skipped = this.workspaceState.get<SidebarStep[]>(`${SKIPPED_KEY}.${next.clientId ?? 'none'}`) ?? [];

    if (next.signedIn && next.clientId) {
      const api = this.getApiClient();
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
  };
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
