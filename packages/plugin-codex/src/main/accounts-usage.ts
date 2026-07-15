import {
  createUsageCacheEntry as createSharedUsageCacheEntry,
  type UsageCacheEntryBase,
} from "@pier/plugin-api/account-usage";
import type { CodexUsageSnapshot } from "../shared/accounts.ts";
import type { AccountUsageResult } from "./types.ts";

export {
  activeUsageCacheKey,
  SYSTEM_USAGE_CACHE_KEY,
  USAGE_MIN_REFETCH_MS,
  USAGE_POLL_INTERVAL_MS,
} from "@pier/plugin-api/account-usage";

export type UsageCacheEntry = UsageCacheEntryBase<
  AccountUsageResult["windows"][number]
>;

export function createUsageCacheEntry(
  result: AccountUsageResult,
  cached: UsageCacheEntry | undefined,
  fetchedAt: number
): UsageCacheEntry {
  return createSharedUsageCacheEntry(result, cached, fetchedAt);
}

export function toUsageSnapshot(entry: UsageCacheEntry): CodexUsageSnapshot {
  return {
    fetchedAt: entry.fetchedAt,
    status: entry.status,
    windows: entry.windows,
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.resetCreditsAvailable === undefined
      ? {}
      : { resetCreditsAvailable: entry.resetCreditsAvailable }),
    ...(entry.raw === undefined ? {} : { raw: entry.raw }),
  };
}
