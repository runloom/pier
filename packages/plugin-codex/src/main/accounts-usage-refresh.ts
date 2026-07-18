import {
  activeUsageCacheKey,
  createInflightCoalescer,
  createUsageCacheEntry,
  USAGE_MIN_REFETCH_MS,
  type UsageCacheEntryBase,
} from "@pier/plugin-api/account-usage";
import { refreshManagedAccountIdentity } from "./accounts-identity-refresh.ts";
import { applyLivePlanType } from "./accounts-records.ts";
import type { CodexAccountsStateStore } from "./state.ts";
import type { AccountUsageResult, AgentAccountProvider } from "./types.ts";

type UsageCache = Record<
  string,
  UsageCacheEntryBase<AccountUsageResult["windows"][number]>
>;

/**
 * Shared refresh body for Codex accounts service: min-refetch gate, inflight
 * coalesce, optional identity backfill, provider.fetchUsage, cache write,
 * snapshot emit.
 */
export function createCodexUsageRefreshRunner(options: {
  accountHomeDir: (accountId: string) => string;
  emitSnapshot: () => void;
  ensureUsageEnv: () => Promise<void>;
  now: () => number;
  provider: AgentAccountProvider;
  stateStore: CodexAccountsStateStore;
  usageCache: UsageCache;
}): (options?: { accountId?: string; force?: boolean }) => Promise<void> {
  const inflight = createInflightCoalescer();
  const {
    accountHomeDir,
    emitSnapshot,
    ensureUsageEnv,
    now,
    provider,
    stateStore,
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
      if (targetId) {
        await refreshManagedAccountIdentity({
          accountHomeDir,
          accountId: targetId,
          now,
          readIdentity: (homeDir) => provider.readIdentity(homeDir),
          stateStore,
        });
      }
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
      if (
        targetId &&
        result.status === "ok" &&
        typeof result.planType === "string" &&
        result.planType.length > 0
      ) {
        const current = stateStore
          .get()
          .accounts.find((entry) => entry.id === targetId);
        if (current) {
          const next = applyLivePlanType(current, result.planType, now());
          if (next !== current) {
            stateStore.mutate((state) => ({
              ...state,
              accounts: state.accounts.map((entry) =>
                entry.id === targetId ? next : entry
              ),
              revision: state.revision + 1,
            }));
            await stateStore.flush();
          }
        }
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
