/**
 * One "Sign in with Rampify" attempt waiting on the browser (spec 78417623).
 *
 * The attempt lives as long as its browser page can still finish: until the
 * callback arrives, the user cancels, a newer attempt replaces it, or
 * `lifetimeMs` passes. How long the editor shows a progress notification is a
 * separate, shorter matter (oauth.ts): a sign-up that takes longer than the
 * notification (waiting for the email code, stepping away) still signs in
 * when the browser hands back.
 *
 * Pure (no vscode import) so it can be tested with fake timers.
 */

/** How long the "Finish signing in…" notification shows before stepping aside. */
export const NOTIFICATION_MS = 10 * 60 * 1000;

/**
 * How long an attempt can still finish in the browser. Longer than the
 * notification: signing up (an email code, a form) can take a while, and a
 * late hand-back still signs in. The code it carries is fresh (the server
 * issues it on Connect, valid 5 minutes).
 */
export const ATTEMPT_LIFETIME_MS = 60 * 60 * 1000;

export class SignInCancelled extends Error {
  constructor() { super('Sign-in cancelled'); }
}

/** The attempt's lifetime ran out before the browser handed back. */
export class SignInExpired extends Error {
  constructor() { super('the browser step wasn’t finished within an hour.'); }
}

export interface BrowserWaitOptions {
  /** How long an attempt waits for its callback before giving up. */
  lifetimeMs: number;
  /** How often to check for a callback another window received. */
  pollMs: number;
  /** A callback for `state` that another window received, if any (claimed once). */
  readHandoff?: (state: string) => URLSearchParams | undefined;
}

interface Attempt {
  state: string;
  settle: (params: URLSearchParams) => void;
  fail: (err: Error) => void;
}

export class BrowserWait {
  private attempt: Attempt | undefined;

  constructor(private readonly opts: BrowserWaitOptions) {}

  /** An attempt is waiting on the browser. */
  get inProgress(): boolean {
    return !!this.attempt;
  }

  /** This attempt (by state) is the one still waiting. */
  isWaitingFor(state: string): boolean {
    return this.attempt?.state === state;
  }

  /**
   * Wait for the browser's callback for `state`; resolves with the sign-in
   * code. One attempt at a time: a new one replaces (cancels) the last.
   * `lifetimeMs` overrides the default (an attempt resumed after a reload
   * gets what's left of its hour).
   */
  start(state: string, lifetimeMs = this.opts.lifetimeMs): Promise<string> {
    this.attempt?.fail(new SignInCancelled());
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => attempt.fail(new SignInExpired()), lifetimeMs);
      // The callback may land in another window (oauth.ts handoffDir).
      const poll = this.opts.readHandoff
        ? setInterval(() => {
            const params = this.opts.readHandoff!(state);
            if (params) { attempt.settle(params); }
          }, this.opts.pollMs)
        : undefined;
      const end = () => {
        clearTimeout(timer);
        if (poll) { clearInterval(poll); }
        if (this.attempt === attempt) { this.attempt = undefined; }
      };
      const attempt: Attempt = {
        state,
        settle: (params) => {
          end();
          const error = params.get('error');
          const code = params.get('code');
          if (error || !code) {
            reject(new Error(params.get('error_description') || error || 'Rampify did not return a sign-in code.'));
          } else {
            resolve(code);
          }
        },
        fail: (err) => {
          end();
          reject(err);
        },
      };
      this.attempt = attempt;
    });
  }

  /** Hand over a callback. False when no attempt is waiting for this state. */
  deliver(state: string, params: URLSearchParams): boolean {
    if (this.attempt?.state !== state) { return false; }
    this.attempt.settle(params);
    return true;
  }

  /** Stop waiting (the user cancelled). */
  cancel(state?: string): void {
    if (this.attempt && (state === undefined || this.attempt.state === state)) {
      this.attempt.fail(new SignInCancelled());
    }
  }
}
