import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { SetupState } from './setup-state';
import { firstPromptOf, renderHomeHtml, type HomeNotice } from './home-html';
import type { SidebarStep } from './setup-steps';
import type { ProjectUpdate, RampifyApiClient } from '../api/client';
import { saveProjectConfig } from '../utils/project-config';
import { forgetAiTool, sendFirstPrompt, sendToAiTool } from '../mcp/connect';

/** What the site form posts. */
interface ProjectFormData {
  name: string;
  domain: string;
}

interface WebviewMessage {
  action?: string;
  arg?: string;
  data?: ProjectFormData;
}

const SEARCH_CONSOLE_URL = 'https://search.google.com/search-console';
/** How long after picking an AI tool the panel checks every 5s for its first request. */
const AI_TOOL_FAST_POLL_MS = 15 * 60 * 1000;

/**
 * The Home panel: the signed-out pitch (mirrors rampify.dev's homepage) and,
 * once signed in, the setup checklist (spec aa7fcad3). Project setup happens
 * here, inline: the browser is only for signing in and Google's Search
 * Console sign-in. The specs list takes over once the project has specs
 * (`rampify.view`, set by SetupState), unless the user picks a view.
 */
export class HomeViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'rampify.home';

  private view: vscode.WebviewView | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private pollMs = 0;
  private readonly disposables: vscode.Disposable[] = [];
  /** Stable per view, so an unchanged state renders identical HTML (and is skipped). */
  private nonce = crypto.randomBytes(16).toString('base64');
  private lastHtml = '';
  private notice: HomeNotice | null = null;
  private editingProject = false;
  private busy: SidebarStep | null = null;
  /** Steps put off in this session ("No site yet"), as the web does for a visit. */
  private later = new Set<SidebarStep>();
  private laterFor: string | null = null;
  /** When an AI tool was picked in this panel (fast polling for a while after). */
  private aiToolPickedAt = 0;

  constructor(
    private readonly state: SetupState,
    private readonly getWebUrl: () => string,
    private readonly getApiClient: () => RampifyApiClient
  ) {
    this.disposables.push(state.onDidChange(() => { this.render(); this.syncPolling(); this.announceFollowUp(); }));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.lastHtml = '';
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.onDidReceiveMessage((msg: WebviewMessage) => this.handle(msg));
    view.onDidChangeVisibility(() => this.syncPolling());
    view.onDidDispose(() => { this.view = undefined; this.syncPolling(); });
    this.render();
    this.state.refresh({ background: true });
    this.syncPolling();
  }

  private render(): void {
    if (!this.view) { return; }
    // "Later" is per project: linking another one starts fresh.
    if (this.state.current.clientId !== this.laterFor) {
      this.later.clear();
      this.laterFor = this.state.current.clientId;
    }
    const html = renderHomeHtml(this.state.current, {
      nonce: this.nonce,
      editorName: vscode.env.appName,
      notice: this.notice,
      editingProject: this.editingProject,
      busy: this.busy,
      later: [...this.later],
    });
    // Re-setting identical HTML would reload the webview and drop focus.
    if (html === this.lastHtml) { return; }
    this.lastHtml = html;
    this.view.webview.html = html;
  }

  /**
   * While the checklist is on screen, re-check so a spec created by the AI, a
   * finished scan, or Search Console connected in the browser shows up without
   * a click: every 10s while a scan runs, otherwise every 30s.
   */
  private syncPolling(): void {
    const s = this.state.current;
    const wanted = !!this.view?.visible && s.signedIn && !!s.clientId;
    // Fast while something is visibly happening: the AI working through the
    // getting-started spec (tasks tick off), or a site scan.
    const gsRunning = !!s.gettingStarted && !['completed', 'verified'].includes(s.gettingStarted.status);
    // Waiting on an AI tool just picked here (its first request ticks the
    // step): fast for a while, not for good, and not once it's put off.
    const aiToolWaiting = !!s.pickedAiTool && !!s.onboarding && s.onboarding.facts.aiTool !== 'used'
      && !this.later.has('ai_tool') && Date.now() - this.aiToolPickedAt < AI_TOOL_FAST_POLL_MS;
    const ms = gsRunning || aiToolWaiting ? 5_000 : s.scan === 'running' ? 10_000 : 30_000;
    if (this.pollTimer && (!wanted || ms !== this.pollMs)) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (wanted && !this.pollTimer) {
      this.pollMs = ms;
      this.pollTimer = setInterval(() => {
        if (vscode.window.state.focused) { this.state.refresh({ background: true }); }
      }, ms);
    }
  }

  private async handle(msg: WebviewMessage): Promise<void> {
    const s = this.state.current;
    const clientId = s.clientId;
    const web = this.getWebUrl();
    const from = encodeURIComponent(vscode.env.uriScheme);
    switch (msg.action) {
      case 'signIn':
      case 'switchProject':
        await vscode.commands.executeCommand(msg.action === 'signIn' ? 'rampify.signIn' : 'rampify.switchProject');
        break;
      case 'signInWithCode':
        await vscode.commands.executeCommand('rampify.signInWithCode');
        break;
      case 'useApiKey':
        await vscode.commands.executeCommand('rampify.setApiKey');
        break;
      case 'linkProject':
        await vscode.commands.executeCommand('rampify.setupProject');
        break;
      case 'openFolder':
        await vscode.commands.executeCommand('vscode.openFolder');
        break;
      case 'setupMcp':
        await vscode.commands.executeCommand('rampify.installMcpServer');
        break;
      case 'connectTool':
        // Its next steps open in the step itself, so no notification.
        if (msg.arg) { await vscode.commands.executeCommand('rampify.connectAiTool', msg.arg, { quiet: true }); }
        this.later.delete('ai_tool');
        this.aiToolPickedAt = Date.now();
        await this.state.refresh();
        break;
      case 'startCopilot':
        // Connect again: enables (if needed) and starts the server, so VS Code asks to sign in.
        await vscode.commands.executeCommand('rampify.connectAiTool', 'copilot', { quiet: true });
        this.aiToolPickedAt = Date.now();
        await this.state.refresh();
        break;
      case 'openMcpServers':
        await vscode.commands.executeCommand('workbench.mcp.listServer').then(undefined, () =>
          vscode.commands.executeCommand('workbench.action.quickOpen', '>MCP: List Servers'));
        break;
      case 'sendPrompt': {
        const tool = this.state.current.pickedAiTool;
        if (tool) { await sendFirstPrompt(tool, firstPromptOf(this.state.current)); }
        break;
      }
      case 'runPlaybook': {
        // The first playbook's prompt (the server's), to the AI tool prompts go to, left in the box to send.
        const playbook = this.state.current.firstPlaybook;
        if (playbook) {
          await sendToAiTool(this.state.current.aiTool, playbook.prompt, { submit: false });
          // The run happens in the AI tool: look again while it's likely going, so the step shows it.
          for (const ms of [45_000, 3 * 60_000, 8 * 60_000, 15 * 60_000]) {
            setTimeout(() => { void this.state.refresh({ background: true }); }, ms);
          }
        }
        break;
      }
      case 'copyPlaybook': {
        const playbook = this.state.current.firstPlaybook;
        if (playbook) {
          await vscode.env.clipboard.writeText(playbook.prompt);
          vscode.window.setStatusBarMessage('Prompt copied', 3000);
        }
        break;
      }
      case 'copyPrompt':
        await vscode.env.clipboard.writeText(firstPromptOf(this.state.current));
        vscode.window.setStatusBarMessage('Prompt copied', 3000);
        break;
      case 'openClaudeCode': {
        const terminal = vscode.window.createTerminal({ name: 'Claude Code', cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath });
        terminal.show();
        terminal.sendText('claude', true);
        break;
      }
      case 'chooseOtherTool':
        await forgetAiTool(this.state.memento, this.state.current.clientId);
        await this.state.refresh();
        break;
      case 'cancelSignIn':
        await vscode.commands.executeCommand('rampify.cancelSignIn');
        break;
      case 'openFolderThenSignIn':
      case 'newProjectThenSignIn':
        await vscode.commands.executeCommand('rampify.openProjectFolder', {
          thenSignIn: true,
          newProject: msg.action === 'newProjectThenSignIn',
        });
        break;

      case 'saveProject':
        if (msg.data) { await this.saveProject(msg.data); }
        break;
      case 'editProject':
        this.editingProject = true;
        this.later.delete('site');
        this.notice = null;
        this.render();
        break;
      case 'cancelEdit':
        this.editingProject = false;
        this.notice = null;
        this.render();
        break;
      case 'skip':
      case 'unskip':
        if (msg.arg) {
          const id = msg.arg as SidebarStep;
          const ok = await this.state.setSkipped(id, msg.action === 'skip');
          this.notice = ok ? null : { kind: 'error', step: id, message: 'That didn\u2019t save. Check your connection and try again.' };
          this.render();
        }
        break;
      case 'later':
      case 'unlater':
        if (msg.arg) {
          if (msg.action === 'later') { this.later.add(msg.arg as SidebarStep); } else { this.later.delete(msg.arg as SidebarStep); }
          this.render();
        }
        break;
      case 'howFound':
        if (msg.arg) {
          this.busy = 'how_found';
          this.render();
          const ok = await this.getApiClient().saveHowFound(msg.arg);
          this.busy = null;
          this.notice = ok ? null : { kind: 'error', step: 'how_found', message: 'That didn\u2019t save. Check your connection and try again.' };
          await this.state.refresh();
          this.render();
        }
        break;
      case 'openCrawlerHelp': {
        const help = this.state.current.scanFailure?.helpUrl;
        if (help) { vscode.env.openExternal(vscode.Uri.parse(help.startsWith('http') ? help : `${web}${help}`)); }
        break;
      }

      case 'startScan':
        await this.startScan();
        break;
      case 'connectGsc':
        // Google's sign-in has to happen in the browser. It returns to the
        // project's Search Console page, which offers "Back to <editor>".
        if (clientId) {
          const returnTo = `/clients/${clientId}/google-search?from=${from}`;
          vscode.env.openExternal(vscode.Uri.parse(
            `${web}/api/gsc/authorize?client_id=${encodeURIComponent(clientId)}&return_to=${encodeURIComponent(returnTo)}`
          ));
        }
        break;
      case 'openGscPage':
        if (clientId) { vscode.env.openExternal(vscode.Uri.parse(`${web}/clients/${clientId}/google-search?from=${from}`)); }
        break;
      case 'openGscHelp':
        vscode.env.openExternal(vscode.Uri.parse(SEARCH_CONSOLE_URL));
        break;

      case 'showSpecs':
        await this.state.showView('specs');
        await vscode.commands.executeCommand('rampify.featureSpecs.focus');
        break;

      case 'openSetup':
        await vscode.commands.executeCommand('rampify.finishSetupInDashboard');
        break;
      case 'openDashboard':
        await vscode.commands.executeCommand('rampify.openDashboard');
        break;
      case 'openDocs':
        await vscode.commands.executeCommand('rampify.openDocs');
        break;
      case 'refresh':
        await this.state.refresh();
        break;
    }
    this.syncPolling();
  }

  /** The spec the AI wrote from the getting-started spec has landed: say so, once. */
  private announceFollowUp(): void {
    const f = this.state.current.followUp;
    const key = 'rampify.announcedFollowUp';
    if (!f || !this.state.current.gettingStarted || this.state.memento.get<string>(key) === f.id) { return; }
    void this.state.memento.update(key, f.id);
    vscode.window.showInformationMessage(`Your spec is ready: "${f.title}"`, 'Start Building', 'Show Specs').then((action) => {
      if (action === 'Start Building') { vscode.commands.executeCommand('rampify.startBuilding', { id: f.id, title: f.title }); }
      if (action === 'Show Specs') { vscode.commands.executeCommand('rampify.showSpecs'); }
    });
  }

  /** Save the site (and the name), then scan it: the same two calls the web setup makes. */
  private async saveProject(d: ProjectFormData): Promise<void> {
    const siteId = this.state.current.siteId;
    if (!siteId) { return; }
    const body: ProjectUpdate = {
      ...(d.name ? { name: d.name } : {}),
      domain: d.domain,
      editor: vscode.env.uriScheme,
    };

    this.busy = 'site';
    this.notice = null;
    this.render();
    const result = await this.getApiClient().updateProject(siteId, body);
    this.busy = null;
    if (!result.ok) {
      this.notice = { kind: 'error', step: 'site', message: result.message };
      this.render();
      return;
    }
    this.editingProject = false;
    const clientId = this.state.current.clientId;
    if (clientId) {
      await saveProjectConfig({ clientId, domain: d.domain }).catch(() => undefined);
    }
    // A site that doesn't answer shows up as the scan's failure, with why.
    await this.startScan();
  }

  private async startScan(): Promise<void> {
    const siteId = this.state.current.siteId;
    if (!siteId) { return; }
    this.busy = 'site';
    this.notice = null;
    this.render();
    const result = await this.getApiClient().startScan(siteId);
    this.busy = null;
    if (result.ok) {
      this.state.scanStarted();
    } else {
      this.notice = { kind: 'error', step: 'site', message: result.message };
    }
    await this.state.refresh();
    this.render();
  }

  dispose(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); }
    this.disposables.forEach((d) => d.dispose());
  }
}
