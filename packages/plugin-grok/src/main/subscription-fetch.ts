import type { FetchImpl } from "./grok-usage-types.ts";
import {
  type GrokSubscriptionInfo,
  parseGrokSubscriptionResult,
} from "./subscription-parse.ts";
import {
  createTimeoutSignal,
  mergeAbortSignals,
} from "./usage-fetch-timeouts.ts";

/** Web membership endpoint (not cli-chat-proxy). Soft-fail only. */
export const GROK_SUBSCRIPTIONS_URL = "https://grok.com/rest/subscriptions";

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
