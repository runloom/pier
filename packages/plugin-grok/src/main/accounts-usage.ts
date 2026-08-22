import {
  type AccountUsageMetric,
  createUsageCacheEntry as createSharedUsageCacheEntry,
  type UsageCacheEntryBase,
} from "@pier/plugin-api/account-usage";
import type { GrokUsageSnapshot } from "../shared/accounts.ts";
import { GROK_RESET_CREDITS_METRIC_ID } from "./reset-credits.ts";
import type { GrokSubscriptionInfo } from "./subscription-parse.ts";
import type { AccountUsageResult } from "./types.ts";

export {
  activeUsageCacheKey,
  SYSTEM_USAGE_CACHE_KEY,
  USAGE_MIN_REFETCH_MS,
  USAGE_POLL_INTERVAL_MS,
} from "@pier/plugin-api/account-usage";

export type UsageCacheEntry = UsageCacheEntryBase<AccountUsageMetric> & {
  subscription?: GrokSubscriptionInfo | undefined;
};

export function createUsageCacheEntry(
  result: AccountUsageResult,
  cached: UsageCacheEntry | undefined,
  attemptedAt: number
): UsageCacheEntry {
  const base = createSharedUsageCacheEntry(result, cached, attemptedAt);
  // Membership is an independent soft hop: quota success does not prove a
  // free downgrade. Replace last-good only after an authoritative membership
  // response (including an explicit free result).
  const subscription =
    result.subscription ??
    (result.subscriptionResolved ? undefined : cached?.subscription);
  return {
    ...base,
    ...(subscription ? { subscription } : {}),
  };
}

export function toUsageSnapshot(entry: UsageCacheEntry): GrokUsageSnapshot {
  const metrics =
    entry.status === "error"
      ? entry.metrics.filter(
          (metric) => metric.id !== GROK_RESET_CREDITS_METRIC_ID
        )
      : entry.metrics;
  return {
    attemptedAt: entry.attemptedAt,
    metrics,
    status: entry.status,
    ...(entry.updatedAt === undefined ? {} : { updatedAt: entry.updatedAt }),
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.subscription ? { subscription: entry.subscription } : {}),
  };
}
