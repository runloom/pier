import type { ClaudeLoginState } from "../shared/accounts.ts";
import {
  LOGIN_SESSION_TTL_MS,
  WATCH_SUPPRESS_MS,
} from "../shared/constants.ts";
import {
  type CompleteOauthLoginDeps,
  completeOauthLogin,
  isPostExchangeLoginError,
  type OauthLoginSession,
  startOauthLoginSession,
} from "./accounts-add-oauth.ts";

export interface OauthLoginController {
  cancel(): void;
  complete(code: string): Promise<void>;
  dispose(): void;
  loginState(): ClaudeLoginState | null;
  start(): void;
}

/**
 * Owns the browser OAuth login session lifecycle: PKCE session with TTL,
 * abort wiring, session restart after post-exchange failures (the auth code
 * is single-use), and lastActionError bookkeeping (a user cancel is not an
 * error).
 */
export function createOauthLoginController(options: {
  completeDeps: Omit<CompleteOauthLoginDeps, "now"> & { now: () => number };
  emitSnapshot: () => void;
  now: () => number;
  setLastActionError: (error: { at: number; message: string } | null) => void;
  setSuppressWatchUntil: (until: number) => void;
}): OauthLoginController {
  let session: OauthLoginSession | null = null;
  let abort: AbortController | null = null;
  const expiredSessions = new WeakSet<OauthLoginSession>();

  /** Session with TTL applied: an expired login is cleared, not resumed. */
  function activeSession(): OauthLoginSession | null {
    if (session && options.now() - session.startedAt > LOGIN_SESSION_TTL_MS) {
      expiredSessions.add(session);
      session = null;
      abort?.abort();
      abort = null;
    }
    return session;
  }

  return {
    cancel(): void {
      abort?.abort();
      session = null;
      abort = null;
      options.setLastActionError(null);
    },
    async complete(code: string): Promise<void> {
      const current = activeSession();
      const currentAbort = abort;
      if (!(current && currentAbort)) {
        throw new Error("No Claude login in progress");
      }
      try {
        options.setSuppressWatchUntil(options.now() + WATCH_SUPPRESS_MS);
        await completeOauthLogin(
          options.completeDeps,
          current,
          code,
          currentAbort.signal
        );
        session = null;
        abort = null;
        options.setLastActionError(null);
        options.emitSnapshot();
      } catch (error) {
        // A TTL expiry mid-exchange aborts the fetch; surface it as the
        // "login expired" error instead of a silent cancellation.
        if (
          error instanceof Error &&
          error.name === "AbortError" &&
          expiredSessions.has(current)
        ) {
          const expired = new Error("No Claude login in progress");
          options.setLastActionError({
            at: options.now(),
            message: expired.message,
          });
          options.emitSnapshot();
          throw expired;
        }
        // A user-initiated cancel is not an error worth recording.
        if (!(error instanceof Error && error.name === "AbortError")) {
          options.setLastActionError({
            at: options.now(),
            message: error instanceof Error ? error.message : String(error),
          });
        }
        // The authorization code is single-use: after a post-exchange failure
        // the session must restart with a fresh authorize URL. A failed code
        // exchange keeps the session so a mistyped code can be re-pasted.
        if (isPostExchangeLoginError(error) && session === current) {
          session = startOauthLoginSession(options.now());
          abort = new AbortController();
        }
        options.emitSnapshot();
        throw error;
      }
    },
    dispose(): void {
      abort?.abort();
    },
    loginState(): ClaudeLoginState | null {
      const current = activeSession();
      if (!current) {
        return null;
      }
      return {
        authorizeUrl: current.authorizeUrl,
        provider: "claude",
        startedAt: current.startedAt,
      };
    },
    start(): void {
      options.setLastActionError(null);
      abort?.abort();
      session = startOauthLoginSession(options.now());
      abort = new AbortController();
      options.emitSnapshot();
    },
  };
}
