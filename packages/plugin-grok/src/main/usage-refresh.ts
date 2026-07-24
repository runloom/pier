import type { FetchImpl } from "./grok-usage-types.ts";
import { type OidcAuthEntry, refreshOidcSession } from "./oidc-session.ts";
import {
  createTimeoutSignal,
  mergeAbortSignals,
  OIDC_REFRESH_TIMEOUT_MS,
} from "./usage-fetch-timeouts.ts";

export function isInvalidGrantError(error: string): boolean {
  return /invalid_grant|401/i.test(error);
}

/**
 * Re-login guidance is only justified when the refresh layer proves the
 * session is dead (invalid_grant / access_denied / missing refresh
 * credentials). Transport errors, 5xx and malformed token responses are
 * transient — reporting them as "session expired" forces needless re-logins.
 */
export function isSessionExpiredRefreshError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes("invalid_grant") ||
    lower.includes("access_denied") ||
    lower.includes("missing refresh credentials") ||
    lower.includes("invalid or expired credentials") ||
    lower.includes("refresh token") ||
    lower.includes("unauthorized") ||
    /\b401\b/.test(lower)
  );
}

const REFRESH_TRANSPORT_RETRY_DELAYS_MS = [500, 1000] as const;

/**
 * Transport-level refresh failures (connection reset, DNS, hop timeout)
 * deserve an immediate linear-backoff retry — a single network blip must not
 * degrade into a "temporarily unavailable" state until the next poll cycle.
 * HTTP answers from the token endpoint (4xx/5xx, OAuth codes) are
 * authoritative and never retried here.
 */
function isTransportRefreshError(error: string): boolean {
  // "Aborted" here means the refresh hop timed out; caller/overall aborts
  // are checked by the wrapper before retrying.
  if (error === "Aborted") {
    return true;
  }
  if (/^HTTP \d/.test(error)) {
    return false;
  }
  return /fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket|SSL|TLS/i.test(
    error
  );
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function refreshWithTransportRetry(options: {
  caller: AbortSignal;
  entry: OidcAuthEntry;
  entryKey: string;
  fetchImpl: FetchImpl;
  overall: AbortSignal | null;
  rawAuthJson: string;
}): Promise<{ authJson: string; sessionKey: string } | { error: string }> {
  for (let attempt = 0; ; attempt += 1) {
    // Fresh merged signal per attempt: a fired hop timeout leaves the
    // previous merged signal permanently aborted.
    const refreshed = await refreshOidcSession({
      entry: options.entry,
      entryKey: options.entryKey,
      fetchImpl: options.fetchImpl,
      rawAuthJson: options.rawAuthJson,
      signal: mergeAbortSignals([
        options.caller,
        options.overall,
        createTimeoutSignal(OIDC_REFRESH_TIMEOUT_MS),
      ]),
    });
    if (!("error" in refreshed)) {
      return refreshed;
    }
    if (options.caller.aborted || options.overall?.aborted) {
      return refreshed;
    }
    const delay = REFRESH_TRANSPORT_RETRY_DELAYS_MS[attempt];
    if (delay === undefined || !isTransportRefreshError(refreshed.error)) {
      return refreshed;
    }
    await sleepWithAbort(delay, options.caller);
    if (options.caller.aborted || options.overall?.aborted) {
      return refreshed;
    }
  }
}
