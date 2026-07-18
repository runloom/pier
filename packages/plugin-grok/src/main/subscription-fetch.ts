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

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

/**
 * Best-effort membership fetch. Never throws into the usage pipeline:
 * network/CF/parse failures return null so quota UI still works.
 */
export async function fetchGrokSubscriptionSoft(options: {
  fetchImpl: FetchImpl;
  sessionKey: string;
  signal: AbortSignal;
  overall?: AbortSignal | null;
}): Promise<GrokSubscriptionInfo | null> {
  if (options.signal.aborted || options.overall?.aborted) return null;
  const hop = createTimeoutSignal(SUBSCRIPTION_HOP_TIMEOUT_MS);
  const signal = mergeAbortSignals([options.signal, options.overall, hop]);
  try {
    const response = await options.fetchImpl(GROK_SUBSCRIPTIONS_URL, {
      headers: {
        Accept: "application/json, text/plain, */*",
        Authorization: `Bearer ${options.sessionKey}`,
        Origin: "https://grok.com",
        Referer: "https://grok.com/",
        "User-Agent": BROWSER_UA,
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
