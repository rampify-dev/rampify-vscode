import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { SetupState } from './setup-state';
import { renderHomeHtml, STARTER_PROMPT } from './home-html';

/**
 * The Home panel: the signed-out pitch (mirrors rampify.dev's homepage) and,
 * once signed in, a setup checklist. Shown until the project has specs, then
 * the Specs tree takes over (`rampify.hasSpecs`, set by SetupState).
 */
export class HomeViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'rampify.home';

  private view: vscode.WebviewView | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly state: SetupState,
    private readonly getWebUrl: () => string
  ) {
    this.disposables.push(state.onDidChange(() => this.render()));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.onDidReceiveMessage((msg: { action?: string }) => this.handle(msg.action));
    view.onDidChangeVisibility(() => this.syncPolling());
    view.onDidDispose(() => { this.view = undefined; this.syncPolling(); });
    this.render();
    this.state.refresh();
    this.syncPolling();
  }

  private render(): void {
    if (!this.view) { return; }
    const webview = this.view.webview;
    webview.html = renderHomeHtml(this.state.current, {
      nonce: crypto.randomBytes(16).toString('base64'),
    });
  }

  /**
   * While the checklist is on screen, re-check every 30s so a spec created by
   * the AI (or setup finished in the browser) shows up without a click.
   */
  private syncPolling(): void {
    const wanted = !!this.view?.visible && this.state.current.signedIn && !!this.state.current.clientId;
    if (wanted && !this.pollTimer) {
      this.pollTimer = setInterval(() => {
        if (vscode.window.state.focused) { this.state.refresh(); }
      }, 30_000);
    } else if (!wanted && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async handle(action: string | undefined): Promise<void> {
    const clientId = this.state.current.clientId;
    const web = this.getWebUrl();
    switch (action) {
      case 'signIn':
      case 'switchProject':
        await vscode.commands.executeCommand(action === 'signIn' ? 'rampify.signIn' : 'rampify.switchProject');
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
      case 'openSetup':
        // ?from= lets the wizard offer "Back to <editor>" (a link to
        // <scheme>://rampify.rampify/open) and skip asking which AI tool.
        if (clientId) {
          vscode.env.openExternal(
            vscode.Uri.parse(`${web}/clients/${clientId}/setup?from=${encodeURIComponent(vscode.env.uriScheme)}`)
          );
        }
        break;
      case 'openDashboard':
        vscode.env.openExternal(vscode.Uri.parse(clientId ? `${web}/clients/${clientId}/home` : `${web}/dashboard`));
        break;
      case 'openDocs':
        vscode.env.openExternal(vscode.Uri.parse(`${web}/docs/integrations/vscode-extension`));
        break;
      case 'copyPrompt':
        await vscode.env.clipboard.writeText(STARTER_PROMPT);
        vscode.window.showInformationMessage('Prompt copied. Paste it into your AI chat.');
        break;
      case 'refresh':
        await this.state.refresh();
        break;
    }
    this.syncPolling();
  }

  dispose(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); }
    this.disposables.forEach((d) => d.dispose());
  }
}
