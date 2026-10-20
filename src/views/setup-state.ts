import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RampifyApiClient } from '../api/client';
import { Session } from '../auth/session';
import { getProjectConfig } from '../utils/project-config';
import { projectDisplayName, primaryProject } from '../utils/project-display';

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
  projectName: string | null;
  /** The setup wizard hasn't been finished or skipped, and there's no site yet. */
  needsProjectSetup: boolean;
  /** Rampify's MCP server is in this folder's (or Cursor's) MCP config. */
  mcpConfigured: boolean;
  /**
   * An AI tool has actually connected to Rampify over MCP (server-reported).
   * Null when the server doesn't say; the checklist falls back to mcpConfigured.
   */
  aiToolConnected: boolean | null;
  specCount: number;
  /** Couldn't reach Rampify or the project. */
  error: string | null;
}

const MCP_DONE_KEY = 'rampify.mcpSetupDone';

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
    next.hasFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    next.signedIn = this.session.isSignedIn;
    next.viaSignIn = this.session.hasProjectToken;
    next.clientId = getProjectConfig()?.clientId ?? null;
    next.mcpConfigured = !!this.workspaceState.get<boolean>(MCP_DONE_KEY) || detectMcpConfig();

    if (next.signedIn && next.clientId) {
      const api = this.getApiClient();
      try {
        const clients = await api.getClients({ silent: true });
        const client = clients.find((c) => c.id === next.clientId);
        next.projectName = client ? projectDisplayName(client) : null;
        const site = await api.getSite(next.clientId, { silent: true });
        const wizardDone = site?.setup_wizard_state === 'completed' || site?.setup_wizard_state === 'dismissed';
        next.needsProjectSetup = !(wizardDone || site?.domain || (client && primaryProject(client)?.domain));
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
    vscode.commands.executeCommand('setContext', 'rampify.hasSpecs', next.specCount > 0);
    this.emitter.fire(next);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function emptySnapshot(): SetupSnapshot {
  return {
    hasFolder: false, signedIn: false, viaSignIn: false, clientId: null, projectName: null,
    needsProjectSetup: false, mcpConfigured: false, aiToolConnected: null, specCount: 0, error: null,
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
