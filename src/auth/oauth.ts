import * as vscode from 'vscode';
import * as crypto from 'crypto';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { ATTEMPT_LIFETIME_MS, BrowserWait, NOTIFICATION_MS, SignInCancelled, SignInExpired } from './browser-wait';
import type { SignInPhase } from '../views/setup-snapshot';

export { SignInCancelled };

/**
 * "Sign in with Rampify": OAuth 2.1 authorization code + PKCE against
 * Rampify's own authorization server, the same one AI coding tools use to
 * connect to the MCP server.
 *
 * The browser returns to <editor scheme>://rampify.rampify/auth-callback,
 * which the editor hands to this extension's UriHandler. The token endpoint
 * answers with an API key scoped to the project the user picked (or created)
 * on the consent screen, plus that project's id.
 *
 * Client identity: Rampify's first-party client (a metadata document listing
 * the extension callback for each VS Code-based editor), shown on the consent
 * screen as "Rampify for VS Code". An editor whose scheme isn't on that list
 * falls back to Dynamic Client Registration (shown as unverified).
 *
 * Where the browser can't hand control back (a window whose callback VS Code
 * rewrites to https, or by choice via "Sign in with a code"), signInWithCode
 * uses the device authorization grant instead: no return address at all.
 */

/** Must match lib/auth/first-party-oauth-clients.ts in the Rampify app. */
const FIRST_PARTY_CLIENT_ID = 'https://www.rampify.dev/oauth/clients/vscode-extension.json';
const FIRST_PARTY_SCHEMES = new Set([
  'vscode', 'vscode-insiders', 'cursor', 'windsurf', 'antigravity',
  'vscodium', 'code-oss', 'kiro', 'trae', 'positron',
]);
/** The authority is the lowercase extension id (Open VSX lists it as Rampify.rampify). */
const CALLBACK_AUTHORITY = 'rampify.rampify';
const CALLBACK_PATH = '/auth-callback';
const DCR_CACHE_KEY = 'rampify.oauthClients';
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** How often a waiting sign-in checks for a callback handed over by another window. */
const HANDOFF_POLL_MS = 1000;
const HANDOFF_MAX_AGE_MS = 15 * 60 * 1000;
/**
 * A handed-off callback no window has claimed this long after it arrived
 * probably has no attempt waiting for it: say so (the file stays, in case a
 * slow window still claims it).
 */
const HANDOFF_UNCLAIMED_MS = 30 * 1000;
/** Callbacks for an attempt that just finished are repeats ("Didn't open? Try again"): ignored this long. */
const FINISHED_MEMORY_MS = 15 * 60 * 1000;
/** The attempt in progress for a folder, kept so a reloaded window can finish it. */
const SAVED_ATTEMPT_KEY = 'rampify.signInAttempt';

export interface PreparedSignIn {
  /** What openExternal is given. */
  authorizeUri: vscode.Uri;
  /** The same, as the string it was parsed from (kept with a saved attempt). */
  authorizeUrl: string;
  redirectUri: string;
  clientId: string;
  verifier: string;
  state: string;
}

export interface SignInResult {
  accessToken: string;
  /** projects.id of the project picked on the consent screen. */
  projectId: string | null;
}

/** A browser sign-in in progress, as kept for a reloaded window (see resume()). */
interface SavedAttempt {
  state: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  webUrl: string;
  authorizeUrl: string;
  startedAt: number;
}

export class RampifyOAuth implements vscode.UriHandler {
  private readonly wait: BrowserWait;
  /**
   * Told where a sign-in is (waiting on the browser or a code, finishing), so
   * the panel can show it. The caller sets 'idle' once the folder is linked.
   */
  onPhase: ((phase: SignInPhase) => void) | undefined;
  private codeSignInActive = false;
  /** Attempts this window finished recently (state → when), so a repeated callback is ignored. */
  private readonly finished = new Map<string, number>();
  /** The browser page of the sign-in in progress, to reopen instead of starting another. */
  private openAuthorizeUri: vscode.Uri | undefined;

  /**
   * `handoffDir` is the extension's global storage folder, shared by every
   * window: the editor sends the browser's callback to the last-focused
   * window, which may not be the one waiting (several windows open). That
   * window drops the callback there and the waiting one picks it up.
   *
   * `secrets` keeps the attempt in progress for this folder (its PKCE
   * verifier included), so a window reloaded mid-sign-in can still finish it
   * (resume()).
   */
  constructor(
    private readonly globalState: vscode.Memento,
    private readonly handoffDir?: string,
    private readonly secrets?: vscode.SecretStorage,
  ) {
    this.wait = new BrowserWait({
      lifetimeMs: ATTEMPT_LIFETIME_MS,
      pollMs: HANDOFF_POLL_MS,
      readHandoff: (state) => this.readHandoff(state),
    });
  }

  /** A sign-in is waiting on the browser in this window. */
  get inProgress(): boolean {
    return this.wait.inProgress;
  }

  /** Stop a sign-in waiting on the browser (Disconnect, or a code sign-in instead). */
  cancel(): void {
    this.wait.cancel();
    void this.forgetAttempt();
  }

  /** Reopen the in-progress sign-in's browser page (a second click on Sign in). */
  reopenBrowser(): void {
    if (this.openAuthorizeUri) { vscode.env.openExternal(this.openAuthorizeUri); }
  }

  /** Called by the editor for <scheme>://rampify.rampify/... URIs. */
  handleUri(uri: vscode.Uri): void {
    if (uri.path !== CALLBACK_PATH) { return; }
    const params = new URLSearchParams(uri.query);
    const state = params.get('state');
    if (!state) { return; }
    if (this.wait.deliver(state, params)) { return; }
    // The browser page's "Didn't open? Try again" repeats a callback this
    // window already finished: nothing to do.
    if (this.recentlyFinished(state)) { return; }
    // Not this window's sign-in (or a stale one): hand it to whichever
    // window is waiting for this state. A forged callback goes nowhere.
    this.writeHandoff(state, uri.query);
    // Still unclaimed a while later: the attempt was cancelled, or its window
    // is gone. Say so rather than leaving the browser's "Connected"
    // unanswered. The file stays, so a slow window can still claim it.
    setTimeout(() => {
      const file = this.handoffFile(state);
      if (!file || !fs.existsSync(file)) { return; }
      vscode.window.showWarningMessage(
        'Your browser finished a Rampify sign-in that no window is waiting for (it was cancelled, or its window closed or moved to another folder). If you\u2019re not signed in, sign in again.',
        'Sign In'
      ).then((action) => {
        if (action === 'Sign In' && !this.wait.inProgress) { vscode.commands.executeCommand('rampify.signIn'); }
      });
    }, HANDOFF_UNCLAIMED_MS);
  }

  private recentlyFinished(state: string): boolean {
    const now = Date.now();
    for (const [s, at] of this.finished) {
      if (now - at > FINISHED_MEMORY_MS) { this.finished.delete(s); }
    }
    return this.finished.has(state);
  }

  private handoffFile(state: string): string | undefined {
    if (!this.handoffDir) { return undefined; }
    const id = crypto.createHash('sha256').update(state).digest('hex').slice(0, 32);
    return path.join(this.handoffDir, `oauth-callback-${id}.txt`);
  }

  private writeHandoff(state: string, query: string): void {
    const file = this.handoffFile(state);
    if (!file) { return; }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, query, { mode: 0o600 });
      // Drop callbacks nobody claimed.
      for (const name of fs.readdirSync(path.dirname(file))) {
        const f = path.join(path.dirname(file), name);
        if (name.startsWith('oauth-callback-') && Date.now() - fs.statSync(f).mtimeMs > HANDOFF_MAX_AGE_MS) {
          fs.rmSync(f, { force: true });
        }
      }
    } catch {
      // Best effort: the waiting window can still time out and retry.
    }
  }

  /**
   * A callback for `state` that another window received, if any. Claimed
   * once: the rename is atomic, so when two windows wait on the same attempt
   * (two windows on one folder) only one gets it.
   */
  private readHandoff(state: string): URLSearchParams | undefined {
    const file = this.handoffFile(state);
    if (!file || !fs.existsSync(file)) { return undefined; }
    const claimed = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.renameSync(file, claimed);
    } catch {
      return undefined; // another window claimed it first
    }
    try {
      return new URLSearchParams(fs.readFileSync(claimed, 'utf8'));
    } catch {
      return undefined;
    } finally {
      fs.rmSync(claimed, { force: true });
    }
  }

  /**
   * Build the authorize request. Separate from signIn so a real editor can be
   * checked end to end without opening a browser.
   */
  async prepare(webUrl: string): Promise<PreparedSignIn | null> {
    const callback = vscode.Uri.parse(`${vscode.env.uriScheme}://${CALLBACK_AUTHORITY}${CALLBACK_PATH}`);
    // Browser-based windows (Codespaces in the browser, some remote setups)
    // rewrite the callback to an https URL we can't register ahead of time:
    // no redirect sign-in there (null → the caller uses the code flow).
    const external = await vscode.env.asExternalUri(callback);
    if (external.scheme !== vscode.env.uriScheme) {
      return null;
    }
    // Desktop VS Code adds ?windowId=N to the external form. Don't use it: a '?'
    // inside redirect_uri doesn't survive openExternal (VS Code hands the
    // browser a decoded copy and re-encodes it, turning ?windowId into
    // %253FwindowId), and it wouldn't match the first-party client's
    // registered callback. The plain callback reaches the last active window,
    // which is the one the user just clicked Sign in from.
    const redirectUri = callback.toString(true);
    const clientId = FIRST_PARTY_SCHEMES.has(vscode.env.uriScheme)
      ? FIRST_PARTY_CLIENT_ID
      : await this.registerClient(webUrl, redirectUri);

    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));

    // Every value here is URL-safe once decoded (an https URL, a scheme://
    // callback, base64url), which is what makes it survive openExternal.
    const authorize = new URL('/oauth/authorize', webUrl);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', clientId);
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');

    return { authorizeUri: vscode.Uri.parse(authorize.toString()), authorizeUrl: authorize.toString(), redirectUri, clientId, verifier, state };
  }

  /**
   * Run the whole browser round trip. `webUrl` is the Rampify origin
   * (production or local dev). Rejects with SignInCancelled if the user
   * cancels the progress notification.
   */
  async signIn(webUrl: string): Promise<SignInResult> {
    const prepared = await this.prepare(webUrl);
    if (!prepared) { return this.signInWithCode(webUrl); }
    const attempt: SavedAttempt = {
      state: prepared.state,
      verifier: prepared.verifier,
      redirectUri: prepared.redirectUri,
      clientId: prepared.clientId,
      webUrl,
      authorizeUrl: prepared.authorizeUrl,
      startedAt: Date.now(),
    };
    const key = this.attemptKey();
    // Not awaited, so the browser opens at once; the record's cleanup waits for it.
    const saved = this.saveAttempt(attempt, key);
    const waiting = this.track(attempt, this.wait.start(attempt.state), key, saved);
    vscode.env.openExternal(prepared.authorizeUri);

    // The notification shows for a while, then steps aside; the attempt keeps
    // waiting, so finishing later in the browser still signs in.
    let stillWaiting = false;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Finish signing in to Rampify in your browser…',
        cancellable: true,
      },
      (_progress, token) => {
        token.onCancellationRequested(() => this.wait.cancel(attempt.state));
        return new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { stillWaiting = true; resolve(); }, NOTIFICATION_MS);
          waiting.then(
            () => { clearTimeout(timer); resolve(); },
            (err) => { clearTimeout(timer); reject(err); },
          );
        });
      }
    );
    if (stillWaiting) {
      vscode.window.showInformationMessage(
        'Still waiting for you to finish signing in to Rampify in your browser. You\u2019ll be signed in here when you do.',
        'Open Browser Page',
        'Sign In with a Code',
        'Cancel'
      ).then((action) => {
        // The message can't be closed from code: once this attempt is over
        // (signed in, cancelled, replaced), its buttons do nothing.
        if (!action || !this.wait.isWaitingFor(attempt.state)) { return; }
        if (action === 'Open Browser Page') { this.reopenBrowser(); }
        if (action === 'Cancel') { this.wait.cancel(attempt.state); }
        if (action === 'Sign In with a Code') { vscode.commands.executeCommand('rampify.signInWithCode'); }
      });
    }
    return this.redeem(attempt, waiting);
  }

  /**
   * Finish a sign-in this folder started before the window reloaded: wait
   * (quietly, for what's left of its hour) for the browser to hand back, then
   * redeem it. Null when there's none.
   */
  async resume(): Promise<SignInResult | null> {
    if (this.wait.inProgress) { return null; }
    const key = this.attemptKey();
    const attempt = await this.loadAttempt(key);
    if (!attempt || this.wait.inProgress) { return null; }
    const left = attempt.startedAt + ATTEMPT_LIFETIME_MS - Date.now();
    if (left <= 0) {
      await this.forgetAttempt(key, attempt.state);
      return null;
    }
    const waiting = this.track(attempt, this.wait.start(attempt.state, left), key);
    try {
      return await this.redeem(attempt, waiting);
    } catch (err) {
      // Started in an earlier session and never finished: nothing to report.
      if (err instanceof SignInExpired) { return null; }
      throw err;
    }
  }

  /**
   * While an attempt waits, Sign in reopens its page; afterwards its saved
   * record goes (under the key it was saved with, even if the folder changed)
   * and repeats of its callback are ignored.
   */
  private track(attempt: SavedAttempt, waiting: Promise<string>, key: string, saved: Promise<void> = Promise.resolve()): Promise<string> {
    const uri = vscode.Uri.parse(attempt.authorizeUrl);
    this.openAuthorizeUri = uri;
    this.onPhase?.('browser');
    // A replaced or cancelled attempt reports nothing over the sign-in that
    // replaced it (a code sign-in started from "still waiting").
    waiting.then(
      () => this.onPhase?.('finishing'),
      () => { if (!this.wait.inProgress && !this.codeSignInActive) { this.onPhase?.('idle'); } },
    );
    const done = () => {
      if (this.openAuthorizeUri === uri) { this.openAuthorizeUri = undefined; }
      this.finished.set(attempt.state, Date.now());
      void saved.then(() => this.forgetAttempt(key, attempt.state));
    };
    waiting.then(done, done);
    return waiting;
  }

  /** Exchange the browser's code for the project's token. */
  private async redeem(attempt: SavedAttempt, waiting: Promise<string>): Promise<SignInResult> {
    const code = await waiting;
    const response = await axios.post(
      new URL('/api/oauth/token', attempt.webUrl).toString(),
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: attempt.redirectUri,
        code_verifier: attempt.verifier,
        client_id: attempt.clientId,
      },
      { timeout: 30000, validateStatus: () => true }
    );
    if (response.status !== 200 || !response.data?.access_token) {
      throw new Error(response.data?.error_description || response.data?.error || `Sign-in failed (${response.status}).`);
    }
    return { accessToken: response.data.access_token, projectId: response.data.project_id ?? null };
  }

  /** The saved attempt's key: one per folder, so a reload into another folder doesn't finish it there. */
  private attemptKey(): string {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? 'none';
    return `${SAVED_ATTEMPT_KEY}.${crypto.createHash('sha256').update(folder).digest('hex').slice(0, 16)}`;
  }

  private async saveAttempt(attempt: SavedAttempt, key: string): Promise<void> {
    await this.secrets?.store(key, JSON.stringify(attempt)).then(undefined, () => undefined);
  }

  private async loadAttempt(key: string): Promise<SavedAttempt | null> {
    try {
      const raw = await this.secrets?.get(key);
      return raw ? (JSON.parse(raw) as SavedAttempt) : null;
    } catch {
      return null;
    }
  }

  /** Drop the saved attempt (only `state`'s, when given, so a newer one stays). */
  private async forgetAttempt(key = this.attemptKey(), state?: string): Promise<void> {
    if (!this.secrets) { return; }
    try {
      if (state !== undefined && (await this.loadAttempt(key))?.state !== state) { return; }
      await this.secrets.delete(key);
    } catch {
      // Best effort: an expired record is ignored by resume().
    }
  }

  /**
   * Device-code sign-in (RFC 8628): no return address needed, so it works in
   * any window. Shows a short code, opens rampify.dev/activate with it, and
   * polls the token endpoint until the user approves, denies, or it expires.
   */
  async signInWithCode(webUrl: string): Promise<SignInResult> {
    // One sign-in at a time: a browser attempt still waiting would otherwise
    // relink the folder if its tab were finished later.
    this.codeSignInActive = true;
    this.cancel();
    this.onPhase?.('code');
    try {
      const result = await this.codeSignIn(webUrl);
      this.onPhase?.('finishing');
      return result;
    } catch (err) {
      this.onPhase?.('idle');
      throw err;
    } finally {
      this.codeSignInActive = false;
    }
  }

  private async codeSignIn(webUrl: string): Promise<SignInResult> {
    const start = await axios.post(
      new URL('/api/oauth/device_authorization', webUrl).toString(),
      { client_id: FIRST_PARTY_CLIENT_ID },
      { timeout: 30000, validateStatus: () => true }
    );
    if (start.status !== 200 || !start.data?.device_code) {
      throw new Error(start.data?.error_description || `Couldn't start sign-in (${start.status}).`);
    }
    const { device_code, user_code, verification_uri, verification_uri_complete } = start.data as {
      device_code: string; user_code: string; verification_uri: string; verification_uri_complete: string;
    };
    let intervalMs = (Number(start.data.interval) || 5) * 1000;
    const deadline = Date.now() + (Number(start.data.expires_in) || 600) * 1000;
    const pageHost = new URL(verification_uri).host + new URL(verification_uri).pathname;

    const openPage = () => vscode.env.openExternal(vscode.Uri.parse(verification_uri_complete));
    // Non-blocking: lets the user copy the code or reopen the page.
    vscode.window.showInformationMessage(
      `Your Rampify sign-in code is ${user_code}. Confirm it at ${pageHost}.`,
      'Copy Code',
      'Open Page'
    ).then((action) => {
      if (action === 'Copy Code') { vscode.env.clipboard.writeText(user_code); }
      if (action === 'Open Page') { openPage(); }
    });

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Confirm code ${user_code} in your browser to sign in to Rampify…`,
        cancellable: true,
      },
      async (_progress, token) => {
        openPage();
        while (Date.now() < deadline) {
          await sleep(intervalMs, token);
          if (token.isCancellationRequested) { throw new SignInCancelled(); }
          const res = await axios.post(
            new URL('/api/oauth/token', webUrl).toString(),
            { grant_type: DEVICE_CODE_GRANT, device_code, client_id: FIRST_PARTY_CLIENT_ID },
            { timeout: 30000, validateStatus: () => true }
          ).catch(() => null);
          if (!res) { continue; } // network blip: keep polling
          if (res.status === 200 && res.data?.access_token) {
            return { accessToken: res.data.access_token, projectId: res.data.project_id ?? null };
          }
          const error = res.data?.error;
          if (error === 'authorization_pending') { continue; }
          if (error === 'slow_down') { intervalMs += 5000; continue; }
          if (error === 'access_denied') { throw new Error('Sign-in was cancelled in the browser.'); }
          if (error === 'expired_token') { break; }
          throw new Error(res.data?.error_description || error || `Sign-in failed (${res.status}).`);
        }
        throw new Error('The sign-in code expired. Start signing in again.');
      }
    );
  }

  /** Dynamic Client Registration for editors not on the first-party list (cached). */
  private async registerClient(webUrl: string, redirectUri: string): Promise<string> {
    const cache = this.globalState.get<Record<string, string>>(DCR_CACHE_KEY) ?? {};
    const cacheKey = `${webUrl}|${redirectUri}`;
    if (cache[cacheKey]) { return cache[cacheKey]; }

    const res = await axios.post(
      new URL('/api/oauth/register', webUrl).toString(),
      {
        client_name: `Rampify extension (${vscode.env.appName})`,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      { timeout: 30000, validateStatus: () => true }
    );
    if (res.status !== 201 || !res.data?.client_id) {
      throw new Error(res.data?.error_description || `Couldn't register this editor with Rampify (${res.status}).`);
    }
    await this.globalState.update(DCR_CACHE_KEY, { ...cache, [cacheKey]: res.data.client_id });
    return res.data.client_id;
  }
}

/** Wait `ms`, resolving early if the user cancels. */
function sleep(ms: number, token: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { sub.dispose(); resolve(); }, ms);
    const sub = token.onCancellationRequested(() => { clearTimeout(timer); sub.dispose(); resolve(); });
  });
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
