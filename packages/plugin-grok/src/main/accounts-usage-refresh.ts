import {
  activeUsageCacheKey,
  createInflightCoalescer,
  createUsageCacheEntry,
  USAGE_MIN_REFETCH_MS,
} from "@pier/plugin-api/account-usage";
import type { UsageCacheEntry } from "./accounts-usage.ts";
import type { GrokAccountProvider } from "./grok-provider.ts";
import type { GrokAccountsStateStore } from "./state.ts";
import type { AccountUsageResult } from "./types.ts";

/**
 * Shared refresh body for the Grok accounts service: min-refetch gate,
 * inflight coalesce, provider.fetchUsage, cache write, snapshot emit.
 */
export function createGrokUsageRefreshRunner(options: {
  accountHomeDir: (accountId: string) => string;
  emitSnapshot: () => void;
  isDisposed: () => boolean;
  now: () => number;
  /** Mirrors a refreshed OIDC session back to the real Grok home. */
  onSessionRefreshed: (accountId: string, authJson: string) => Promise<void>;
  provider: GrokAccountProvider;
  /** Service-level abort: dispose() cancels in-flight fetches through this. */
  signal: AbortSignal;
  stateStore: GrokAccountsStateStore;
  usageCache: Record<string, UsageCacheEntry>;
}): (refreshOptions?: {
  accountId?: string;
  force?: boolean;
}) => Promise<void> {
  const {
    accountHomeDir,
    emitSnapshot,
    isDisposed,
    now,
    onSessionRefreshed,
    provider,
    signal,
    stateStore,
    usageCache,
  } = options;
  const inflight = createInflightCoalescer();

  return async (
    refreshOptions: { accountId?: string; force?: boolean } = {}
  ) => {
    const state = stateStore.get();
    const targetId = refreshOptions.accountId ?? state.activeAccountId;
    if (
      targetId &&
      !state.accounts.some((account) => account.id === targetId)
    ) {
      // Removal race (refresh-all cycle vs remove): a vanished account is a
      // silent no-op, not an error that aborts the rest of the cycle.
      return;
    }
    const cacheKey = activeUsageCacheKey(targetId);
    const cached = usageCache[cacheKey];
    if (
      !refreshOptions.force &&
      cached &&
      now() - cached.fetchedAt < USAGE_MIN_REFETCH_MS
    ) {
      return;
    }

    // Coalesce concurrent refresh for the same account (settings lease +
    // manual refresh + poll must not stampede multi-hop remote calls).
    await inflight.run(cacheKey, async () => {
      if (isDisposed()) return;
      const latestCached = usageCache[cacheKey];
      if (
        !refreshOptions.force &&
        latestCached &&
        now() - latestCached.fetchedAt < USAGE_MIN_REFETCH_MS
      ) {
        return;
      }

      let result: AccountUsageResult;
      if (targetId) {
        // Re-resolve inside the coalesced body: the account may have been
        // removed while this refresh waited in line.
        const account = stateStore
          .get()
          .accounts.find((entry) => entry.id === targetId);
        if (!account) return;
        try {
          result = await provider.fetchUsage({
            kind: account.kind === "api_key" ? "api_key" : "oidc",
            signal,
            ...(account.kind === "api_key"
              ? {}
              : {
                  accountHomeDir: accountHomeDir(targetId),
                  onSessionRefreshed: (authJson: string) =>
                    onSessionRefreshed(targetId, authJson),
                }),
          });
        } catch (error) {
          result = {
            error: error instanceof Error ? error.message : String(error),
            status: "error",
            windows: [],
          };
        }
      } else {
        result = {
          status: "error",
          error: "No active Grok account",
          windows: [],
        };
      }

      if (isDisposed()) return;
      // The account may have been removed while the fetch was in flight;
      // writing would resurrect the cache entry doRemove just deleted.
      if (
        targetId &&
        !stateStore.get().accounts.some((entry) => entry.id === targetId)
      ) {
        return;
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
