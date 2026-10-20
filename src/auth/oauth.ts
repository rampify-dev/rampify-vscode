import * as vscode from 'vscode';
import * as crypto from 'crypto';
import axios from 'axios';

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
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;
const DCR_CACHE_KEY = 'rampify.oauthClients';
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

export interface PreparedSignIn {
  /** What openExternal is given. */
  authorizeUri: vscode.Uri;
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

interface Pending {
  state: string;
  resolve: (code: string) => void;
  reject: (err: Error) => void;
}

export class SignInCancelled extends Error {
  constructor() { super('Sign-in cancelled'); }
}

export class RampifyOAuth implements vscode.UriHandler {
  private pending: Pending | undefined;

  constructor(private readonly globalState: vscode.Memento) {}

  /** Called by the editor for <scheme>://rampify.rampify/... URIs. */
  handleUri(uri: vscode.Uri): void {
    if (uri.path !== CALLBACK_PATH || !this.pending) { return; }
    const params = new URLSearchParams(uri.query);
    // A stale or forged callback (wrong state) is ignored, not an error.
    if (params.get('state') !== this.pending.state) { return; }
    const pending = this.pending;
    this.pending = undefined;
    const error = params.get('error');
    const code = params.get('code');
    if (error || !code) {
      pending.reject(new Error(params.get('error_description') || error || 'Rampify did not return a sign-in code.'));
    } else {
      pending.resolve(code);
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

    return { authorizeUri: vscode.Uri.parse(authorize.toString()), redirectUri, clientId, verifier, state };
  }

  /**
   * Run the whole browser round trip. `webUrl` is the Rampify origin
   * (production or local dev). Rejects with SignInCancelled if the user
   * cancels the progress notification.
   */
  async signIn(webUrl: string): Promise<SignInResult> {
    const prepared = await this.prepare(webUrl);
    if (!prepared) { return this.signInWithCode(webUrl); }
    const { authorizeUri, redirectUri, clientId, verifier, state } = prepared;

    const code = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Finish signing in to Rampify in your browser…',
        cancellable: true,
      },
      (_progress, token) => {
        const waiting = this.waitForCode(state, token);
        vscode.env.openExternal(authorizeUri);
        return waiting;
      }
    );

    const response = await axios.post(
      new URL('/api/oauth/token', webUrl).toString(),
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        client_id: clientId,
      },
      { timeout: 30000, validateStatus: () => true }
    );
    if (response.status !== 200 || !response.data?.access_token) {
      throw new Error(response.data?.error_description || response.data?.error || `Sign-in failed (${response.status}).`);
    }
    return { accessToken: response.data.access_token, projectId: response.data.project_id ?? null };
  }

  /**
   * Device-code sign-in (RFC 8628): no return address needed, so it works in
   * any window. Shows a short code, opens rampify.dev/activate with it, and
   * polls the token endpoint until the user approves, denies, or it expires.
   */
  async signInWithCode(webUrl: string): Promise<SignInResult> {
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

  private waitForCode(state: string, token: vscode.CancellationToken): Promise<string> {
    // One sign-in at a time: a new attempt supersedes an abandoned one.
    this.pending?.reject(new SignInCancelled());
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.state === state) { this.pending = undefined; }
        reject(new Error('it timed out waiting for the browser.'));
      }, SIGN_IN_TIMEOUT_MS);
      const done = <T>(fn: (v: T) => void) => (v: T) => { clearTimeout(timer); sub.dispose(); fn(v); };
      const sub = token.onCancellationRequested(() => {
        if (this.pending?.state === state) { this.pending = undefined; }
        done(reject)(new SignInCancelled());
      });
      this.pending = { state, resolve: done(resolve), reject: done(reject) };
    });
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
