import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { SetupState } from './setup-state';
import { BUILD_PROMPT, renderHomeHtml, specPromptFor, STARTER_PROMPT, type HomeNotice } from './home-html';
import type { SidebarStep, StartingPoint } from './setup-steps';
import type { ProjectUpdate, RampifyApiClient } from '../api/client';
import { saveProjectConfig } from '../utils/project-config';

/** What the project form posts. */
interface ProjectFormData {
  name: string;
  type: 'website' | 'app';
  sp: StartingPoint | null;
  domain: string;
}

interface WebviewMessage {
  action?: string;
  arg?: string;
  data?: ProjectFormData;
}

const SEARCH_CONSOLE_URL = 'https://search.google.com/search-console';

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

  constructor(
    private readonly state: SetupState,
    private readonly getWebUrl: () => string,
    private readonly getApiClient: () => RampifyApiClient
  ) {
    this.disposables.push(state.onDidChange(() => { this.render(); this.syncPolling(); }));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.lastHtml = '';
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.onDidReceiveMessage((msg: WebviewMessage) => this.handle(msg));
    view.onDidChangeVisibility(() => this.syncPolling());
    view.onDidDispose(() => { this.view = undefined; this.syncPolling(); });
    this.render();
    this.state.refresh();
    this.syncPolling();
  }

  private render(): void {
    if (!this.view) { return; }
    const html = renderHomeHtml(this.state.current, {
      nonce: this.nonce,
      editorName: vscode.env.appName,
      notice: this.notice,
      editingProject: this.editingProject,
      busy: this.busy,
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
    const ms = s.scan === 'running' ? 10_000 : 30_000;
    if (this.pollTimer && (!wanted || ms !== this.pollMs)) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (wanted && !this.pollTimer) {
      this.pollMs = ms;
      this.pollTimer = setInterval(() => {
        if (vscode.window.state.focused) { this.state.refresh(); }
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

      case 'saveProject':
        if (msg.data) { await this.saveProject(msg.data, { verifyLive: true }); }
        break;
      case 'saveNotLive':
        if (msg.data) { await this.saveProject({ ...msg.data, sp: 'domain_only' }, { verifyLive: false }); }
        break;
      case 'saveAnyway':
        if (msg.data) { await this.saveProject(msg.data, { verifyLive: false }); }
        break;
      case 'editProject':
        this.editingProject = true;
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
        if (msg.arg) { await this.state.setSkipped(msg.arg as SidebarStep, msg.action === 'skip'); }
        break;

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

      case 'copySpecPrompt': {
        const what = (msg.arg ?? '').trim();
        await vscode.env.clipboard.writeText(what ? specPromptFor(what) : BUILD_PROMPT);
        vscode.window.showInformationMessage('Prompt copied. Paste it into your AI chat.');
        break;
      }
      case 'copyPrompt':
        await vscode.env.clipboard.writeText(STARTER_PROMPT);
        vscode.window.showInformationMessage('Prompt copied. Paste it into your AI chat.');
        break;
      case 'showSpecs':
        await this.state.showView('specs');
        await vscode.commands.executeCommand('rampify.featureSpecs.focus');
        break;

      case 'openSetup':
        // The rest of setup (business profile, launch stage) lives in the
        // dashboard. ?from= lets it offer "Back to <editor>".
        if (clientId) { vscode.env.openExternal(vscode.Uri.parse(`${web}/clients/${clientId}/setup?from=${from}`)); }
        break;
      case 'openDashboard':
        vscode.env.openExternal(vscode.Uri.parse(clientId ? `${web}/clients/${clientId}/home` : `${web}/dashboard`));
        break;
      case 'openDocs':
        vscode.env.openExternal(vscode.Uri.parse(`${web}/docs/integrations/vscode-extension`));
        break;
      case 'refresh':
        await this.state.refresh();
        break;
    }
    this.syncPolling();
  }

  private async saveProject(d: ProjectFormData, opts: { verifyLive: boolean }): Promise<void> {
    const siteId = this.state.current.siteId;
    if (!siteId) { return; }
    const isWebsite = d.type === 'website';
    const hasSite = isWebsite && (d.sp === 'domain_only' || d.sp === 'live_site');
    const body: ProjectUpdate = {
      name: d.name,
      project_type: d.type,
      ...(isWebsite && d.sp ? { starting_point: d.sp } : {}),
      ...(hasSite && d.domain ? { domain: d.domain } : {}),
      verify_live: opts.verifyLive && d.sp === 'live_site',
      advance_wizard: true,
      editor: vscode.env.uriScheme,
    };

    this.busy = 'project';
    this.notice = null;
    this.render();
    const result = await this.getApiClient().updateProject(siteId, body);
    this.busy = null;
    if (result.ok) {
      this.editingProject = false;
      const clientId = this.state.current.clientId;
      if (clientId && hasSite && d.domain) {
        await saveProjectConfig({ clientId, domain: d.domain }).catch(() => undefined);
      }
      await this.state.setSkipped('project', false);
    } else {
      this.notice = result.unreachable
        ? { kind: 'unreachable', domain: d.domain }
        : { kind: 'error', step: 'project', message: result.message };
      this.render();
    }
  }

  private async startScan(): Promise<void> {
    const siteId = this.state.current.siteId;
    if (!siteId) { return; }
    this.busy = 'scan';
    this.notice = null;
    this.render();
    const result = await this.getApiClient().startScan(siteId);
    this.busy = null;
    if (!result.ok) {
      this.notice = { kind: 'error', step: 'scan', message: result.message };
    }
    await this.state.refresh();
    this.render();
  }

  dispose(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); }
    this.disposables.forEach((d) => d.dispose());
  }
}
