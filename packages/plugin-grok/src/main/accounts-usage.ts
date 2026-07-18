import {
  createUsageCacheEntry as createSharedUsageCacheEntry,
  type UsageCacheEntryBase,
} from "@pier/plugin-api/account-usage";
import type { GrokUsageSnapshot } from "../shared/accounts.ts";
import type { GrokSubscriptionInfo } from "./subscription-parse.ts";
import type { AccountUsageResult } from "./types.ts";

export {
  activeUsageCacheKey,
  SYSTEM_USAGE_CACHE_KEY,
  USAGE_MIN_REFETCH_MS,
  USAGE_POLL_INTERVAL_MS,
} from "@pier/plugin-api/account-usage";

export type UsageCacheEntry = UsageCacheEntryBase<
  AccountUsageResult["windows"][number]
> & {
  subscription?: GrokSubscriptionInfo | undefined;
};

export function createUsageCacheEntry(
  result: AccountUsageResult,
  cached: UsageCacheEntry | undefined,
  fetchedAt: number
): UsageCacheEntry {
  const base = createSharedUsageCacheEntry(result, cached, fetchedAt);
  // Retain last-good membership only when usage itself failed. An ok fetch
  // that soft-omits subscription must not freeze a previous paid tier after
  // a real free downgrade (membership 403/timeout).
  const subscription =
    result.subscription ??
    (result.status === "error" ? cached?.subscription : undefined);
  return {
    ...base,
    ...(subscription ? { subscription } : {}),
  };
}

export function toUsageSnapshot(entry: UsageCacheEntry): GrokUsageSnapshot {
  return {
    fetchedAt: entry.fetchedAt,
    status: entry.status,
    windows: entry.windows,
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.raw === undefined ? {} : { raw: entry.raw }),
    ...(entry.subscription ? { subscription: entry.subscription } : {}),
  };
}
