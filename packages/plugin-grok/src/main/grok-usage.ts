import { withOneRetry } from "@pier/plugin-api/account-usage";
import {
  classifyBillingHttpError,
  isAuthFailureMessage,
} from "./billing-http-error.ts";
import { parseGrokBillingResult } from "./billing-parse.ts";
import { type FetchImpl, resolveFetchImpl } from "./grok-usage-types.ts";
import {
  accessTokenExpired,
  extractSessionKeyFromAuthJson,
  needsRefresh,
  type OidcAuthEntry,
  selectOidcAuthEntry,
} from "./oidc-session.ts";
import { withSoftSubscription } from "./subscription-fetch.ts";
import type { AccountUsageResult } from "./types.ts";
import {
  BILLING_HOP_TIMEOUT_MS,
  BILLING_TIMEOUT_ERROR,
  createTimeoutSignal,
  isTimeoutOrAbortError,
  mergeAbortSignals,
  USAGE_OVERALL_DEADLINE_MS,
  USAGE_RETRY_OVERALL_DEADLINE_MS,
} from "./usage-fetch-timeouts.ts";
import {
  isInvalidGrantError,
  isSessionExpiredRefreshError,
  refreshWithTransportRetry,
} from "./usage-refresh.ts";
import {
  ACCESS_DENIED_ERROR,
  abortedResult,
  accessDeniedResult,
  authFailureResult,
  hasQuotaMetric,
  mergeScalarMetrics,
  SESSION_EXPIRED_RELOGIN_ERROR,
  softenEmptyQuotaResult,
  timedOutResult,
  transientFailureResult,
} from "./usage-result.ts";

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

export {
  ACCESS_DENIED_ERROR,
  SESSION_EXPIRED_RELOGIN_ERROR,
  USAGE_TEMPORARILY_UNAVAILABLE_ERROR,
} from "./usage-result.ts";

export const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing";
export const GROK_BILLING_CREDITS_URL =
  "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
export const API_KEY_QUOTA_ERROR =
  "API key accounts cannot report Grok quota — switch to an OIDC account";

function userIdFromEntry(entry: OidcAuthEntry | undefined): string | null {
  const id = entry?.user_id;
  return typeof id === "string" && id.length > 0 ? id : null;
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
      metrics: [],
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
  let latestSessionKey: string | null = extractSessionKeyFromAuthJson(authJson);
  const onAuthJsonUpdated = async (next: string): Promise<void> => {
    authJson = next;
    const selected = selectOidcAuthEntry(authJson);
    if (selected && typeof selected.entry.key === "string") {
      latestSessionKey = selected.entry.key;
    }
    await options.onAuthJsonUpdated?.(next);
  };
  const result = await withOneRetry<AccountUsageResult>({
    isAborted: () => options.signal.aborted,
    shouldRetry: (retryResult) =>
      retryResult.status === "error" &&
      retryResult.error === BILLING_TIMEOUT_ERROR,
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
  // Billing-success paths already attempted membership inside the attempt.
  // Only retry here when billing failed/empty, so we don't double-hit
  // the subscription endpoint after a soft-null response.
  if (
    result.subscription === undefined &&
    latestSessionKey &&
    !options.signal.aborted &&
    !hasQuotaMetric(result)
  ) {
    return await withSoftSubscription(result, {
      caller: options.signal,
      fetchImpl: resolveFetchImpl(options.fetchImpl),
      overall: null,
      sessionKey: latestSessionKey,
      userId: userIdFromEntry(selectOidcAuthEntry(authJson)?.entry),
    });
  }
  return result;
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
  const fetchImpl = resolveFetchImpl(options.fetchImpl);
  const overall = createTimeoutSignal(options.overallDeadlineMs);
  const caller = options.signal;
  let sessionKey = selected.entry.key;
  try {
    throwIfCallerOrOverallAborted(caller, overall);
    if (needsRefresh(selected.entry, Date.now())) {
      const refreshed = await refreshWithTransportRetry({
        caller,
        entry: selected.entry,
        entryKey: selected.entryKey,
        fetchImpl,
        overall,
        rawAuthJson: authJson,
      });
      if ("error" in refreshed) {
        if (caller.aborted) return abortedResult();
        if (overall?.aborted || refreshed.error === "Aborted") {
          return timedOutResult();
        }
        let refreshError: string | null = refreshed.error;
        // invalid_grant: the refresh_token may have been rotated by another
        // instance (official CLI / different Pier window). Re-select the
        // latest entry from auth.json and retry once with the new token.
        if (isInvalidGrantError(refreshError)) {
          const reselected = selectOidcAuthEntry(authJson);
          if (
            reselected &&
            typeof reselected.entry.refresh_token === "string" &&
            reselected.entry.refresh_token !== selected.entry.refresh_token
          ) {
            const retryRefreshed = await refreshWithTransportRetry({
              caller,
              entry: reselected.entry,
              entryKey: reselected.entryKey,
              fetchImpl,
              overall,
              rawAuthJson: authJson,
            });
            if ("error" in retryRefreshed) {
              if (caller.aborted) return abortedResult();
              if (overall?.aborted || retryRefreshed.error === "Aborted") {
                return timedOutResult();
              }
              refreshError = retryRefreshed.error;
            } else {
              authJson = retryRefreshed.authJson;
              sessionKey = retryRefreshed.sessionKey;
              selected = selectOidcAuthEntry(authJson) ?? reselected;
              await options.onAuthJsonUpdated?.(authJson);
              throwIfCallerOrOverallAborted(caller, overall);
              refreshError = null;
            }
          }
        }
        // When the access token is still inside its validity window, proceed
        // with it and let the billing API decide — even after invalid_grant,
        // since a revoked refresh token says nothing about the access token.
        if (
          refreshError !== null &&
          accessTokenExpired(selected.entry, Date.now())
        ) {
          if (isSessionExpiredRefreshError(refreshError)) {
            return authFailureResult(refreshError);
          }
          // Transient refresh failure (network/5xx/...) with an already
          // expired access token: nothing usable left, report a temporary
          // failure and keep last-good data instead of claiming re-login.
          return transientFailureResult(refreshError);
        }
      } else {
        authJson = refreshed.authJson;
        sessionKey = refreshed.sessionKey;
        selected = selectOidcAuthEntry(authJson) ?? selected;
        await options.onAuthJsonUpdated?.(authJson);
        throwIfCallerOrOverallAborted(caller, overall);
      }
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
            metrics: [],
          };
        }
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          return {
            status: "error",
            error: "Invalid Grok billing response",
            metrics: [],
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
            metrics: [],
          };
        }
        return {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          metrics: [],
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
      const refreshed = await refreshWithTransportRetry({
        caller,
        entry: selected.entry,
        entryKey: selected.entryKey,
        fetchImpl,
        overall,
        rawAuthJson: authJson,
      });
      if ("error" in refreshed) {
        if (caller.aborted) return abortedResult();
        if (overall?.aborted || refreshed.error === "Aborted") {
          return timedOutResult();
        }
        let refreshError = refreshed.error;
        // invalid_grant: re-select from auth.json for a rotated refresh_token
        // and retry once before giving up.
        if (isInvalidGrantError(refreshError)) {
          const reselected = selectOidcAuthEntry(authJson);
          if (
            reselected &&
            typeof reselected.entry.refresh_token === "string" &&
            reselected.entry.refresh_token !== selected.entry.refresh_token
          ) {
            const retryRefreshed = await refreshWithTransportRetry({
              caller,
              entry: reselected.entry,
              entryKey: reselected.entryKey,
              fetchImpl,
              overall,
              rawAuthJson: authJson,
            });
            if (!("error" in retryRefreshed)) {
              authJson = retryRefreshed.authJson;
              sessionKey = retryRefreshed.sessionKey;
              selected = selectOidcAuthEntry(authJson) ?? reselected;
              headers.Authorization = `Bearer ${sessionKey}`;
              await options.onAuthJsonUpdated?.(authJson);
              if (caller.aborted) return abortedResult();
              if (overall?.aborted) return timedOutResult();
              return await request(url);
            }
            if (caller.aborted) return abortedResult();
            if (overall?.aborted || retryRefreshed.error === "Aborted") {
              return timedOutResult();
            }
            refreshError = retryRefreshed.error;
          }
        }
        return isSessionExpiredRefreshError(refreshError)
          ? authFailureResult(refreshError)
          : transientFailureResult(refreshError);
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
    if (hasQuotaMetric(credits)) {
      // Membership hop is independent of the billing overall deadline —
      // otherwise a slow credits path can abort the subscription request
      // and leave the UI stuck on bare "OIDC".
      return await withSoftSubscription(credits, {
        caller,
        fetchImpl,
        overall: null,
        sessionKey,
        userId: userIdFromEntry(selected?.entry),
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
      if (hasQuotaMetric(creditsRetry)) {
        return await withSoftSubscription(creditsRetry, {
          caller,
          fetchImpl,
          overall: null,
          sessionKey,
          userId: userIdFromEntry(selected?.entry),
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
    const fallback = await requestWithOptionalRefresh(GROK_BILLING_URL);
    if (hasQuotaMetric(fallback)) {
      return await withSoftSubscription(mergeScalarMetrics(fallback, credits), {
        caller,
        fetchImpl,
        overall: null,
        sessionKey,
        userId: userIdFromEntry(selected?.entry),
      });
    }
    return softenEmptyQuotaResult(
      credits.status === "error" ? credits : fallback
    );
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
      metrics: [],
    };
  }
}
