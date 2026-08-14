import type { FetchImpl } from "./grok-usage-types.ts";
import { fetchGrokRemainingResetsSoft } from "./reset-credits.ts";
import {
  type GrokSubscriptionInfo,
  parseGrokSubscriptionResult,
  parseGrokUserSubscriptionResult,
} from "./subscription-parse.ts";
import { parseGrokTaskUsage } from "./task-usage.ts";
import type { AccountUsageResult } from "./types.ts";
import {
  createTimeoutSignal,
  mergeAbortSignals,
} from "./usage-fetch-timeouts.ts";

/** Web membership endpoint (not cli-chat-proxy). Soft-fail only. */
export const GROK_SUBSCRIPTIONS_URL = "https://grok.com/rest/subscriptions";
export const GROK_USER_URL =
  "https://cli-chat-proxy.grok.com/v1/user?include=subscription";
export const GROK_RATE_LIMITS_URL = "https://grok.com/rest/rate-limits";

/** Keep short so billing remains the critical path. */
export const SUBSCRIPTION_HOP_TIMEOUT_MS = 8000;

const CLI_USER_AGENT = "grok-cli/1.0.0";

/**
 * Best-effort membership fetch. Never throws into the usage pipeline:
 * network/CF/parse failures return null so quota UI still works.
 *
 * Uses CLI client headers (x-xai-token-auth, x-grok-client-version) matching
 * the official grok-cli, not browser伪装 — the subscription endpoint rejects
 * or returns empty for requests missing the CLI auth marker.
 */
export async function fetchGrokSubscriptionSoft(options: {
  fetchImpl: FetchImpl;
  sessionKey: string;
  signal: AbortSignal;
  overall?: AbortSignal | null;
  userId?: string | null;
}): Promise<GrokSubscriptionInfo | null> {
  if (options.signal.aborted || options.overall?.aborted) return null;
  const hop = createTimeoutSignal(SUBSCRIPTION_HOP_TIMEOUT_MS);
  const signal = mergeAbortSignals([options.signal, options.overall, hop]);
  try {
    const response = await options.fetchImpl(GROK_SUBSCRIPTIONS_URL, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        Authorization: `Bearer ${options.sessionKey}`,
        "User-Agent": CLI_USER_AGENT,
        "x-xai-token-auth": "xai-grok-cli",
        "x-grok-client-mode": "cli",
        "x-grok-client-version": "pier-plugin-grok/1.0.0",
        ...(options.userId ? { "x-userid": options.userId } : {}),
      },
      method: "GET",
      signal,
    });
    if (options.signal.aborted || options.overall?.aborted) return null;
    if (!response.ok) return null;
    const text = await response.text();
    if (options.signal.aborted || options.overall?.aborted) return null;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return null;
    }
    return parseGrokSubscriptionResult(json);
  } catch {
    // Soft-fail: transport/timeout/parse issues never poison billing.
    return null;
  }
}

async function fetchGrokUserSubscriptionSoft(options: {
  fetchImpl: FetchImpl;
  overall?: AbortSignal | null;
  sessionKey: string;
  signal: AbortSignal;
  userId?: string | null;
}): Promise<GrokSubscriptionInfo | null> {
  if (options.signal.aborted || options.overall?.aborted) return null;
  try {
    const response = await options.fetchImpl(GROK_USER_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${options.sessionKey}`,
        "User-Agent": CLI_USER_AGENT,
        "x-xai-token-auth": "xai-grok-cli",
        "x-grok-client-mode": "cli",
        "x-grok-client-version": "pier-plugin-grok/1.0.0",
        ...(options.userId ? { "x-userid": options.userId } : {}),
      },
      method: "GET",
      signal: mergeAbortSignals([
        options.signal,
        options.overall,
        createTimeoutSignal(SUBSCRIPTION_HOP_TIMEOUT_MS),
      ]),
    });
    if (!response.ok || options.signal.aborted || options.overall?.aborted) {
      return null;
    }
    return parseGrokUserSubscriptionResult(JSON.parse(await response.text()));
  } catch {
    return null;
  }
}

async function fetchGrokTaskUsageSoft(options: {
  fetchImpl: FetchImpl;
  sessionKey: string;
  signal: AbortSignal;
  userId?: string | null;
}): Promise<ReturnType<typeof parseGrokTaskUsage>> {
  try {
    const response = await options.fetchImpl(GROK_RATE_LIMITS_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${options.sessionKey}`,
        "User-Agent": CLI_USER_AGENT,
        "x-xai-token-auth": "xai-grok-cli",
        ...(options.userId ? { "x-userid": options.userId } : {}),
      },
      method: "GET",
      signal: mergeAbortSignals([
        options.signal,
        createTimeoutSignal(SUBSCRIPTION_HOP_TIMEOUT_MS),
      ]),
    });
    if (!response.ok || options.signal.aborted) return [];
    return parseGrokTaskUsage(JSON.parse(await response.text()));
  } catch {
    return [];
  }
}

/**
 * Attach best-effort membership to a billing result. Never fails the usage
 * pipeline: a soft-null subscription leaves the result untouched.
 */
export async function withSoftSubscription(
  result: AccountUsageResult,
  options: {
    caller: AbortSignal;
    fetchImpl: FetchImpl;
    overall: AbortSignal | null;
    sessionKey: string;
    userId?: string | null;
  }
): Promise<AccountUsageResult> {
  if (options.caller.aborted || options.overall?.aborted) {
    return result;
  }
  const membershipPromise = (async (): Promise<GrokSubscriptionInfo | null> => {
    // Start both independent probes together. Await the authoritative endpoint
    // first, but reuse the already-running fallback when the direct probe
    // soft-fails so their timeout windows never add up.
    const directPromise = fetchGrokSubscriptionSoft({
      fetchImpl: options.fetchImpl,
      overall: options.overall,
      sessionKey: options.sessionKey,
      signal: options.caller,
      ...(options.userId ? { userId: options.userId } : {}),
    });
    const fallbackAbort = new AbortController();
    const fallbackPromise = fetchGrokUserSubscriptionSoft({
      fetchImpl: options.fetchImpl,
      overall: options.overall,
      sessionKey: options.sessionKey,
      signal: mergeAbortSignals([options.caller, fallbackAbort.signal]),
      ...(options.userId ? { userId: options.userId } : {}),
    });
    const direct = await directPromise;
    if (direct) {
      fallbackAbort.abort();
      return direct;
    }
    return await fallbackPromise;
  })();
  const extraMetricsPromise =
    result.status === "ok"
      ? Promise.all([
          fetchGrokTaskUsageSoft({
            fetchImpl: options.fetchImpl,
            sessionKey: options.sessionKey,
            signal: options.caller,
            ...(options.userId ? { userId: options.userId } : {}),
          }),
          fetchGrokRemainingResetsSoft({
            fetchImpl: options.fetchImpl,
            sessionKey: options.sessionKey,
            signal: options.caller,
            ...(options.userId ? { userId: options.userId } : {}),
          }),
        ])
      : Promise.resolve([[], []] as const);
  const [subscription, extraMetrics] = await Promise.all([
    membershipPromise,
    extraMetricsPromise,
  ]);
  const existingIds = new Set(result.metrics.map((metric) => metric.id));
  const extra = extraMetrics.flat().filter((metric) => {
    if (existingIds.has(metric.id)) return false;
    existingIds.add(metric.id);
    return true;
  });
  return {
    ...result,
    metrics: [...result.metrics, ...extra],
    ...(subscription
      ? { subscription, subscriptionResolved: true as const }
      : {}),
  };
}
