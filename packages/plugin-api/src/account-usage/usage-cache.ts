/** Shared account-usage cache helpers for official account plugins. */

export const USAGE_MIN_REFETCH_MS = 5 * 60 * 1000;
export const USAGE_POLL_INTERVAL_MS = 15 * 60 * 1000;
export const SYSTEM_USAGE_CACHE_KEY = "__system__";

export interface AccountUsageQuotaMetric {
  availability?: "available" | "blocked";
  groupId: string;
  id: string;
  kind: "quota";
  name?: string;
  resetsAt?: number;
  usedPercent: number;
  windowMinutes?: number;
}

export interface AccountUsageScalarMetric {
  currency?: string;
  format: "count" | "currency" | "number";
  id: string;
  kind: "scalar";
  name?: string;
  value: number;
}

export type AccountUsageMetric =
  | AccountUsageQuotaMetric
  | AccountUsageScalarMetric;

export interface UsageResultBase<M extends AccountUsageMetric> {
  error?: string;
  metrics: M[];
  status: "error" | "ok";
}

export interface UsageCacheEntryBase<M extends AccountUsageMetric> {
  attemptedAt: number;
  error?: string;
  metrics: M[];
  status: "error" | "ok";
  updatedAt?: number;
}

/**
 * On error, retain the last successful metrics and their timestamp. The latest
 * attempt is tracked separately so the UI never presents stale data as fresh.
 */
export function createUsageCacheEntry<M extends AccountUsageMetric>(
  result: UsageResultBase<M>,
  cached: UsageCacheEntryBase<M> | undefined,
  attemptedAt: number
): UsageCacheEntryBase<M> {
  const retained = result.status === "error" ? cached : undefined;
  const updatedAt = result.status === "ok" ? attemptedAt : retained?.updatedAt;
  return {
    attemptedAt,
    metrics:
      result.status === "error" ? (retained?.metrics ?? []) : result.metrics,
    status: result.status,
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(result.error ? { error: result.error } : {}),
  };
}

export function activeUsageCacheKey(activeAccountId: string | null): string {
  return activeAccountId ?? SYSTEM_USAGE_CACHE_KEY;
}
