import * as vscode from 'vscode';

/**
 * Where the extension's Rampify credentials live: the editor's SecretStorage
 * (OS keychain), never settings.json.
 *
 * - Signing in with Rampify (OAuth) yields a key scoped to the project picked
 *   on the consent screen. SecretStorage is shared by every window, so tokens
 *   are stored per workspace (project) id: signing in from repo B must not
 *   replace repo A's token.
 * - A pasted API key ("Use an API key instead") is account-wide and is the
 *   fallback for any folder without a project token.
 */

const ACCOUNT_KEY = 'rampify.apiKey';
const PROJECT_TOKEN_PREFIX = 'rampify.projectToken.';

export class Session implements vscode.Disposable {
  private accountKey = '';
  private projectToken = '';
  private projectId: string | undefined;
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];

  /** Fires when the key for the current folder may have changed. */
  readonly onDidChange = this.emitter.event;

  private constructor(private readonly secrets: vscode.SecretStorage) {
    // Another window signing in/out updates this one too.
    this.disposables.push(
      secrets.onDidChange(async (e) => {
        if (e.key === ACCOUNT_KEY || e.key.startsWith(PROJECT_TOKEN_PREFIX)) {
          await this.reload();
        }
      })
    );
  }

  static async create(secrets: vscode.SecretStorage, projectId: string | undefined): Promise<Session> {
    const session = new Session(secrets);
    await session.migrateSettingsKey();
    session.projectId = projectId;
    await session.reload();
    return session;
  }

  /** The key to call Rampify with in this folder ('' when signed out). */
  get apiKey(): string {
    return this.projectToken || this.accountKey;
  }

  get isSignedIn(): boolean {
    return !!this.apiKey;
  }

  /** True when signed in through OAuth for the linked project. */
  get hasProjectToken(): boolean {
    return !!this.projectToken;
  }

  /** The linked project changed (Setup Project Link / sign-in / Disconnect). */
  async setProject(projectId: string | undefined): Promise<void> {
    this.projectId = projectId;
    await this.reload();
  }

  async storeProjectToken(projectId: string, token: string): Promise<void> {
    await this.secrets.store(PROJECT_TOKEN_PREFIX + projectId, token);
    if (projectId === this.projectId) { await this.reload(); }
  }

  async storeAccountKey(key: string): Promise<void> {
    await this.secrets.store(ACCOUNT_KEY, key);
    await this.reload();
  }

  /** Sign out of this folder's project, and drop the account key. */
  async clear(): Promise<void> {
    if (this.projectId) { await this.secrets.delete(PROJECT_TOKEN_PREFIX + this.projectId); }
    await this.secrets.delete(ACCOUNT_KEY);
    await this.reload();
  }

  private async reload(): Promise<void> {
    const before = this.apiKey;
    this.accountKey = (await this.secrets.get(ACCOUNT_KEY)) ?? '';
    this.projectToken = this.projectId
      ? (await this.secrets.get(PROJECT_TOKEN_PREFIX + this.projectId)) ?? ''
      : '';
    if (this.apiKey !== before) { this.emitter.fire(); }
  }

  /** Versions before 0.7.0 kept the key in settings.json (plain text). */
  private async migrateSettingsKey(): Promise<void> {
    const config = vscode.workspace.getConfiguration('rampify');
    const inspected = config.inspect<string>('apiKey');
    const legacy = inspected?.globalValue || inspected?.workspaceValue;
    if (!legacy) { return; }
    if (!(await this.secrets.get(ACCOUNT_KEY))) {
      await this.secrets.store(ACCOUNT_KEY, legacy);
    }
    await config.update('apiKey', undefined, vscode.ConfigurationTarget.Global);
    if (inspected?.workspaceValue) {
      await config.update('apiKey', undefined, vscode.ConfigurationTarget.Workspace);
    }
  }

  dispose(): void {
    this.emitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
