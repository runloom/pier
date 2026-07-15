import type { GrokUsageSnapshot } from "../shared/accounts.ts";
import type { AccountUsageResult } from "./types.ts";

export const USAGE_MIN_REFETCH_MS = 5 * 60 * 1000;
export const USAGE_POLL_INTERVAL_MS = 15 * 60 * 1000;
export const SYSTEM_USAGE_CACHE_KEY = "__system__";

export interface UsageCacheEntry {
  error?: string;
  fetchedAt: number;
  raw?: unknown;
  status: "error" | "ok";
  windows: AccountUsageResult["windows"];
}

export function createUsageCacheEntry(
  result: AccountUsageResult,
  cached: UsageCacheEntry | undefined,
  fetchedAt: number
): UsageCacheEntry {
  const retained = result.status === "error" ? cached : undefined;
  return {
    fetchedAt,
    raw: result,
    status: result.status,
    windows:
      result.status === "error" ? (retained?.windows ?? []) : result.windows,
    ...(result.error ? { error: result.error } : {}),
  };
}

export function toUsageSnapshot(entry: UsageCacheEntry): GrokUsageSnapshot {
  return {
    fetchedAt: entry.fetchedAt,
    status: entry.status,
    windows: entry.windows,
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.raw === undefined ? {} : { raw: entry.raw }),
  };
}

export function activeUsageCacheKey(activeAccountId: string | null): string {
  return activeAccountId ?? SYSTEM_USAGE_CACHE_KEY;
}
