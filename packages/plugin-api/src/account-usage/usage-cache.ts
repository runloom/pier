/** Shared account-usage cache helpers (Codex / Grok / future account plugins). */

export const USAGE_MIN_REFETCH_MS = 5 * 60 * 1000;
export const USAGE_POLL_INTERVAL_MS = 15 * 60 * 1000;
export const SYSTEM_USAGE_CACHE_KEY = "__system__";

export interface UsageResultBase<W> {
  error?: string;
  raw?: unknown;
  /** Codex-only optional field; other plugins omit. */
  resetCreditsAvailable?: number;
  status: "error" | "ok";
  windows: W[];
}

export interface UsageCacheEntryBase<W> {
  error?: string;
  fetchedAt: number;
  raw?: unknown;
  resetCreditsAvailable?: number;
  status: "error" | "ok";
  windows: W[];
}

/**
 * On error, retain previous windows (and reset credits when present) so UI can
 * keep last-good meters instead of blanking the dashboard.
 */
export function createUsageCacheEntry<W>(
  result: UsageResultBase<W>,
  cached: UsageCacheEntryBase<W> | undefined,
  fetchedAt: number
): UsageCacheEntryBase<W> {
  const retained = result.status === "error" ? cached : undefined;
  const resetCredits =
    result.resetCreditsAvailable === undefined
      ? retained?.resetCreditsAvailable
      : result.resetCreditsAvailable;
  return {
    fetchedAt,
    raw: result.raw === undefined ? result : result.raw,
    status: result.status,
    windows:
      result.status === "error" ? (retained?.windows ?? []) : result.windows,
    ...(result.error ? { error: result.error } : {}),
    ...(resetCredits === undefined
      ? {}
      : { resetCreditsAvailable: resetCredits }),
  };
}

export function activeUsageCacheKey(activeAccountId: string | null): string {
  return activeAccountId ?? SYSTEM_USAGE_CACHE_KEY;
}
