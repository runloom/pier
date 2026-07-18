import { withOneRetry } from "@pier/plugin-api/account-usage";
import {
  classifyBillingHttpError,
  isAuthFailureMessage,
} from "./billing-http-error.ts";
import { parseGrokBillingResult } from "./billing-parse.ts";
import type { FetchImpl } from "./grok-usage-types.ts";
import {
  needsRefresh,
  refreshOidcSession,
  selectOidcAuthEntry,
} from "./oidc-session.ts";
import { fetchGrokSubscriptionSoft } from "./subscription-fetch.ts";
import type { AccountUsageResult } from "./types.ts";
import {
  BILLING_HOP_TIMEOUT_MS,
  BILLING_TIMEOUT_ERROR,
  createTimeoutSignal,
  isTimeoutOrAbortError,
  mergeAbortSignals,
  OIDC_REFRESH_TIMEOUT_MS,
  USAGE_OVERALL_DEADLINE_MS,
  USAGE_RETRY_OVERALL_DEADLINE_MS,
} from "./usage-fetch-timeouts.ts";

export {
  type BillingHttpErrorClassification,
  type BillingHttpErrorKind,
  classifyBillingHttpError,
} from "./billing-http-error.ts";
export type { FetchImpl } from "./grok-usage-types.ts";
export {
  extractSessionKeyFromAuthJson,
  selectOidcAuthEntry,
} from "./oidc-session.ts";
export {
  BILLING_HOP_TIMEOUT_MS,
  BILLING_TIMEOUT_ERROR,
  OIDC_REFRESH_TIMEOUT_MS,
  USAGE_OVERALL_DEADLINE_MS,
  USAGE_RETRY_OVERALL_DEADLINE_MS,
} from "./usage-fetch-timeouts.ts";

export const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing";
export const GROK_BILLING_CREDITS_URL =
  "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
export const API_KEY_QUOTA_ERROR =
  "API key accounts cannot report Grok quota — switch to an OIDC account";
export const SESSION_EXPIRED_RELOGIN_ERROR =
  "Grok session expired — re-login required";
export const ACCESS_DENIED_ERROR =
  "Grok account cannot access billing for this product";

async function withSoftSubscription(
  result: AccountUsageResult,
  options: {
    caller: AbortSignal;
    fetchImpl: FetchImpl;
    overall: AbortSignal | null;
    sessionKey: string;
  }
): Promise<AccountUsageResult> {
  if (result.status !== "ok" || result.windows.length === 0) {
    return result;
  }
  if (options.caller.aborted || options.overall?.aborted) {
    return result;
  }
  const subscription = await fetchGrokSubscriptionSoft({
    fetchImpl: options.fetchImpl,
    overall: options.overall,
    sessionKey: options.sessionKey,
    signal: options.caller,
  });
  if (!subscription) return result;
  return { ...result, subscription };
}
function throwIfCallerOrOverallAborted(
  caller: AbortSignal,
  overall: AbortSignal | null
): void {
  if (caller.aborted) {
    if (caller.reason !== undefined) throw caller.reason;
    const error = new Error("Aborted");
    error.name = "AbortError";
    throw error;
  }
  if (overall?.aborted) {
    const error = new Error(BILLING_TIMEOUT_ERROR);
    error.name = "TimeoutError";
    throw error;
  }
}

function abortedResult(): AccountUsageResult {
  return { status: "error", error: "Aborted", windows: [] };
}

function timedOutResult(): AccountUsageResult {
  return { status: "error", error: BILLING_TIMEOUT_ERROR, windows: [] };
}

function authFailureResult(detail?: string): AccountUsageResult {
  return {
    status: "error",
    error: detail
      ? `${SESSION_EXPIRED_RELOGIN_ERROR} (${detail})`
      : SESSION_EXPIRED_RELOGIN_ERROR,
    windows: [],
  };
}

function accessDeniedResult(detail?: string): AccountUsageResult {
  return {
    status: "error",
    error: detail ? `${ACCESS_DENIED_ERROR} (${detail})` : ACCESS_DENIED_ERROR,
    windows: [],
  };
}

export async function fetchGrokUsage(options: {
  authJson: string | null;
  kind: "api_key" | "oidc";
  fetchImpl?: FetchImpl;
  onAuthJsonUpdated?: (authJson: string) => Promise<void> | void;
  signal: AbortSignal;
}): Promise<AccountUsageResult> {
  if (options.kind === "api_key") {
    return {
      status: "error",
      error: API_KEY_QUOTA_ERROR,
      windows: [],
    };
  }
  if (options.signal.aborted) {
    return abortedResult();
  }
  if (!options.authJson) {
    return authFailureResult("session token missing");
  }

  // Keep latest authJson if OIDC refresh succeeds mid-flight before a retry.
  let authJson = options.authJson;
  const onAuthJsonUpdated = async (next: string): Promise<void> => {
    authJson = next;
    await options.onAuthJsonUpdated?.(next);
  };
  return withOneRetry({
    isAborted: () => options.signal.aborted,
    shouldRetry: (result) =>
      result.status === "error" && result.error === BILLING_TIMEOUT_ERROR,
    run: ({ isRetry }) =>
      fetchGrokUsageAttempt({
        authJson,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        onAuthJsonUpdated,
        overallDeadlineMs: isRetry
          ? USAGE_RETRY_OVERALL_DEADLINE_MS
          : USAGE_OVERALL_DEADLINE_MS,
        signal: options.signal,
      }),
  });
}

async function fetchGrokUsageAttempt(options: {
  authJson: string;
  fetchImpl?: FetchImpl;
  onAuthJsonUpdated?: (authJson: string) => Promise<void> | void;
  overallDeadlineMs: number;
  signal: AbortSignal;
}): Promise<AccountUsageResult> {
  let authJson = options.authJson;
  let selected = selectOidcAuthEntry(authJson);
  if (!selected || typeof selected.entry.key !== "string") {
    return authFailureResult("session token missing");
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const overall = createTimeoutSignal(options.overallDeadlineMs);
  const caller = options.signal;

  let sessionKey = selected.entry.key;
  try {
    throwIfCallerOrOverallAborted(caller, overall);
    if (needsRefresh(selected.entry, Date.now())) {
      const refreshSignal = mergeAbortSignals([
        caller,
        overall,
        createTimeoutSignal(OIDC_REFRESH_TIMEOUT_MS),
      ]);
      const refreshed = await refreshOidcSession({
        entry: selected.entry,
        entryKey: selected.entryKey,
        fetchImpl,
        rawAuthJson: authJson,
        signal: refreshSignal,
      });
      if ("error" in refreshed) {
        if (caller.aborted) return abortedResult();
        if (overall?.aborted || refreshed.error === "Aborted") {
          return timedOutResult();
        }
        return authFailureResult(refreshed.error);
      }
      authJson = refreshed.authJson;
      sessionKey = refreshed.sessionKey;
      selected = selectOidcAuthEntry(authJson) ?? selected;
      await options.onAuthJsonUpdated?.(authJson);
      throwIfCallerOrOverallAborted(caller, overall);
    }

    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${sessionKey}`,
      "x-grok-client-mode": "cli",
      "x-grok-client-version": "pier-plugin-grok/1.0.0",
    };

    async function request(url: string): Promise<AccountUsageResult> {
      if (caller.aborted) return abortedResult();
      if (overall?.aborted) return timedOutResult();
      const hop = createTimeoutSignal(BILLING_HOP_TIMEOUT_MS);
      const signal = mergeAbortSignals([caller, overall, hop]);
      try {
        const response = await fetchImpl(url, {
          headers,
          method: "GET",
          signal,
        });
        if (caller.aborted) return abortedResult();
        if (overall?.aborted) return timedOutResult();
        const text = await response.text();
        if (caller.aborted) return abortedResult();
        if (overall?.aborted) return timedOutResult();
        if (!response.ok) {
          const classification = classifyBillingHttpError(
            response.status,
            text
          );
          if (classification.kind === "auth") {
            return authFailureResult(classification.detail);
          }
          if (classification.kind === "access") {
            return accessDeniedResult(classification.detail);
          }
          return {
            status: "error",
            error: classification.detail,
            windows: [],
          };
        }
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          return {
            status: "error",
            error: "Invalid Grok billing response",
            windows: [],
          };
        }
        return parseGrokBillingResult(json);
      } catch (error) {
        if (caller.aborted) return abortedResult();
        if (overall?.aborted) return timedOutResult();
        // Hop timeout / transport: local error so credits→fallback can run.
        if (hop?.aborted || isTimeoutOrAbortError(error)) {
          return {
            status: "error",
            error: BILLING_TIMEOUT_ERROR,
            windows: [],
          };
        }
        return {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          windows: [],
        };
      }
    }

    async function requestWithOptionalRefresh(
      url: string
    ): Promise<AccountUsageResult> {
      const first = await request(url);
      if (caller.aborted) return abortedResult();
      if (overall?.aborted) return timedOutResult();
      if (
        first.status !== "error" ||
        !first.error ||
        !first.error.includes(SESSION_EXPIRED_RELOGIN_ERROR) ||
        typeof selected?.entry.refresh_token !== "string"
      ) {
        return first;
      }
      const refreshSignal = mergeAbortSignals([
        caller,
        overall,
        createTimeoutSignal(OIDC_REFRESH_TIMEOUT_MS),
      ]);
      const refreshed = await refreshOidcSession({
        entry: selected.entry,
        entryKey: selected.entryKey,
        fetchImpl,
        rawAuthJson: authJson,
        signal: refreshSignal,
      });
      if ("error" in refreshed) {
        if (caller.aborted) return abortedResult();
        if (overall?.aborted || refreshed.error === "Aborted") {
          return timedOutResult();
        }
        return authFailureResult(refreshed.error);
      }
      authJson = refreshed.authJson;
      sessionKey = refreshed.sessionKey;
      selected = selectOidcAuthEntry(authJson) ?? selected;
      headers.Authorization = `Bearer ${sessionKey}`;
      await options.onAuthJsonUpdated?.(authJson);
      if (caller.aborted) return abortedResult();
      if (overall?.aborted) return timedOutResult();
      return await request(url);
    }

    // credits first (true rate-limit quota). Cash /v1/billing is last-resort
    // only — it reports monthly USD spend and can look "healthy" while weekly
    // credits are exhausted. Retry credits once on transport/timeout before cash.
    let credits = await requestWithOptionalRefresh(GROK_BILLING_CREDITS_URL);
    if (credits.status === "ok" && credits.windows.length > 0) {
      return await withSoftSubscription(credits, {
        caller,
        fetchImpl,
        overall,
        sessionKey,
      });
    }
    if (
      credits.status === "error" &&
      (credits.error?.includes(SESSION_EXPIRED_RELOGIN_ERROR) ||
        credits.error?.includes(ACCESS_DENIED_ERROR))
    ) {
      return credits;
    }
    if (caller.aborted) return abortedResult();
    if (overall?.aborted) {
      return credits.status === "error" ? credits : timedOutResult();
    }
    const creditsTransportFailed =
      credits.status === "error" &&
      (credits.error === BILLING_TIMEOUT_ERROR ||
        (typeof credits.error === "string" &&
          /timeout|network|fetch|ECONN|ENOTFOUND|unavailable/i.test(
            credits.error
          )));
    // Only re-hit credits on transport/timeout — sparse empty responses go to cash.
    if (creditsTransportFailed) {
      const creditsRetry = await requestWithOptionalRefresh(
        GROK_BILLING_CREDITS_URL
      );
      if (creditsRetry.status === "ok" && creditsRetry.windows.length > 0) {
        return await withSoftSubscription(creditsRetry, {
          caller,
          fetchImpl,
          overall,
          sessionKey,
        });
      }
      if (
        creditsRetry.status === "error" &&
        (creditsRetry.error?.includes(SESSION_EXPIRED_RELOGIN_ERROR) ||
          creditsRetry.error?.includes(ACCESS_DENIED_ERROR))
      ) {
        return creditsRetry;
      }
      credits = creditsRetry;
    }
    if (caller.aborted) return abortedResult();
    if (overall?.aborted) {
      return credits.status === "error" ? credits : timedOutResult();
    }
    // Last resort: cash monthly spend (labeled "Monthly spend" in parser).
    const fallback = await requestWithOptionalRefresh(GROK_BILLING_URL);
    if (fallback.status === "ok" && fallback.windows.length > 0) {
      return await withSoftSubscription(fallback, {
        caller,
        fetchImpl,
        overall,
        sessionKey,
      });
    }
    return credits.status === "error" ? credits : fallback;
  } catch (error) {
    if (caller.aborted) {
      return abortedResult();
    }
    const message = error instanceof Error ? error.message : String(error);
    if (isTimeoutOrAbortError(error) || /timeout|aborted/i.test(message)) {
      return timedOutResult();
    }
    if (isAuthFailureMessage(message)) {
      return authFailureResult(message);
    }
    return {
      status: "error",
      error: message || "Grok billing request failed",
      windows: [],
    };
  }
}
