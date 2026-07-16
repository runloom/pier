import {
  activeUsageCacheKey,
  createInflightCoalescer,
  createUsageCacheEntry,
  USAGE_MIN_REFETCH_MS,
  type UsageCacheEntryBase,
} from "@pier/plugin-api/account-usage";
import type { AccountUsageResult, AgentAccountProvider } from "./types.ts";

type UsageCache = Record<
  string,
  UsageCacheEntryBase<AccountUsageResult["windows"][number]>
>;

/**
 * Shared refresh body for Codex accounts service: min-refetch gate, inflight
 * coalesce, provider.fetchUsage, cache write, snapshot emit.
 */
export function createCodexUsageRefreshRunner(options: {
  accountHomeDir: (accountId: string) => string;
  emitSnapshot: () => void;
  ensureUsageEnv: () => Promise<void>;
  now: () => number;
  provider: AgentAccountProvider;
  usageCache: UsageCache;
}): (options?: { accountId?: string; force?: boolean }) => Promise<void> {
  const inflight = createInflightCoalescer();
  const {
    accountHomeDir,
    emitSnapshot,
    ensureUsageEnv,
    now,
    provider,
    usageCache,
  } = options;

  return async (
    refreshOptions: { accountId?: string; force?: boolean } = {}
  ) => {
    // Caller validates account existence and resolves targetId.
    const targetId = refreshOptions.accountId;
    const cacheKey = activeUsageCacheKey(targetId ?? null);
    const cached = usageCache[cacheKey];
    if (
      !refreshOptions.force &&
      cached &&
      now() - cached.fetchedAt < USAGE_MIN_REFETCH_MS
    ) {
      return;
    }

    await inflight.run(cacheKey, async () => {
      const latestCached = usageCache[cacheKey];
      if (
        !refreshOptions.force &&
        latestCached &&
        now() - latestCached.fetchedAt < USAGE_MIN_REFETCH_MS
      ) {
        return;
      }
      await ensureUsageEnv();
      const abort = new AbortController();
      let result: AccountUsageResult;
      try {
        result = await provider.fetchUsage(
          targetId ? accountHomeDir(targetId) : undefined,
          abort.signal
        );
      } catch (error) {
        result = {
          error: error instanceof Error ? error.message : String(error),
          status: "error" as const,
          windows: [],
        };
      }
      usageCache[cacheKey] = createUsageCacheEntry(
        result,
        usageCache[cacheKey],
        now()
      );
      emitSnapshot();
    });
  };
}
