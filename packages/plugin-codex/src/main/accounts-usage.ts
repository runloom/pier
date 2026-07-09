import type { CodexUsageSnapshot } from "../shared/accounts.ts";
import type { AccountUsageResult } from "./types.ts";

export const USAGE_MIN_REFETCH_MS = 5 * 60 * 1000;
export const USAGE_POLL_INTERVAL_MS = 15 * 60 * 1000;
export const SYSTEM_USAGE_CACHE_KEY = "__system__";

export interface UsageCacheEntry {
  error?: string;
  fetchedAt: number;
  raw?: unknown;
  session?: AccountUsageResult["session"];
  status: "error" | "ok";
  weekly?: AccountUsageResult["weekly"];
}

export function toUsageSnapshot(entry: UsageCacheEntry): CodexUsageSnapshot {
  return {
    fetchedAt: entry.fetchedAt,
    status: entry.status,
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.session ? { session: entry.session } : {}),
    ...(entry.weekly ? { weekly: entry.weekly } : {}),
    ...(entry.raw === undefined ? {} : { raw: entry.raw }),
  };
}

export function activeUsageCacheKey(activeAccountId: string | null): string {
  return activeAccountId ?? SYSTEM_USAGE_CACHE_KEY;
}
