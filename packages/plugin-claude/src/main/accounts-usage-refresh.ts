import {
  activeUsageCacheKey,
  createInflightCoalescer,
  createUsageCacheEntry,
  USAGE_MIN_REFETCH_MS,
  type UsageCacheEntryBase,
} from "@pier/plugin-api/account-usage";
import type {
  ClaudeUsageSnapshot,
  ClaudeUsageWindow,
} from "../shared/accounts.ts";
import type { ClaudeAccountProvider } from "./claude-provider.ts";
import { type FetchImpl, LOGIN_EXPIRED_ERROR } from "./oauth.ts";
import type { ClaudeAccountsStateStore } from "./state.ts";
import { type AccountUsageResult, fetchClaudeUsage } from "./usage-fetch.ts";

export { activeUsageCacheKey } from "@pier/plugin-api/account-usage";

export type UsageCacheEntry = UsageCacheEntryBase<ClaudeUsageWindow>;

export function toUsageSnapshot(entry: UsageCacheEntry): ClaudeUsageSnapshot {
  return {
    fetchedAt: entry.fetchedAt,
    status: entry.status,
    windows: entry.windows,
    ...(entry.error ? { error: entry.error } : {}),
  };
}

/**
 * Persist a rotated credential envelope (Anthropic rotates refresh tokens on
 * every use). The managed-store write happens immediately — even after
 * dispose — because losing a rotated single-use token permanently kills the
 * stored login. Only the active-store mirror runs on the mutation queue
 * (identity-guarded so an external login switch is never clobbered).
 */
export function createRotatedCredentialPersister(options: {
  accountHomeDir: (accountId: string) => string;
  enqueueMirror: (operation: () => Promise<void>) => Promise<void>;
  logger?: { warn(message: string, meta?: unknown): void } | undefined;
  now: () => number;
  provider: Pick<
    ClaudeAccountProvider,
    | "readCurrentIdentity"
    | "writeCurrentCredentialRaw"
    | "writeManagedCredentialRaw"
  >;
  setSuppressWatchUntil: (until: number) => void;
  stateStore: ClaudeAccountsStateStore;
  watchSuppressMs: number;
}): (accountId: string, envelope: string) => Promise<void> {
  return async (accountId, envelope) => {
    try {
      await options.provider.writeManagedCredentialRaw(
        options.accountHomeDir(accountId),
        envelope
      );
    } catch (error) {
      options.logger?.warn(
        "[pier.claude] could not persist rotated credential",
        { error: error instanceof Error ? error.message : String(error) }
      );
      return;
    }
    await options.enqueueMirror(async () => {
      const account = options.stateStore
        .get()
        .accounts.find((entry) => entry.id === accountId);
      if (!account || options.stateStore.get().activeAccountId !== accountId) {
        return;
      }
      try {
        const currentIdentity = await options.provider.readCurrentIdentity();
        if (
          currentIdentity &&
          currentIdentity.providerAccountId !== account.providerAccountId
        ) {
          return;
        }
        options.setSuppressWatchUntil(options.now() + options.watchSuppressMs);
        await options.provider.writeCurrentCredentialRaw(envelope);
        options.setSuppressWatchUntil(options.now() + options.watchSuppressMs);
      } catch (error) {
        options.logger?.warn(
          "[pier.claude] could not mirror rotated credential to active store",
          { error: error instanceof Error ? error.message : String(error) }
        );
      }
    });
  };
}

/**
 * Shared refresh body for the Claude accounts service: min-refetch gate,
 * inflight coalesce, usage fetch (with token refresh), cache write, snapshot
 * emit. Mirrors the Grok refresh runner.
 *
 * Claude twist: the ACTIVE account's live credential can be rotated by
 * Claude Code itself without any watchable file change (macOS Keychain), so
 * before reading the managed envelope we capture the live store via
 * `syncActiveBeforeRead`, and on a session-expired result we re-sync and
 * retry once before caching the error.
 */
export function createClaudeUsageRefreshRunner(options: {
  accountHomeDir: (accountId: string) => string;
  emitSnapshot: () => void;
  fetchImpl?: FetchImpl | undefined;
  isDisposed: () => boolean;
  now: () => number;
  /** Persists a rotated credential envelope (refresh token rotation). */
  onCredentialRefreshed: (accountId: string, envelope: string) => Promise<void>;
  provider: Pick<ClaudeAccountProvider, "readManagedCredentialRaw">;
  /** Service-level abort: dispose() cancels in-flight fetches through this. */
  signal: AbortSignal;
  stateStore: ClaudeAccountsStateStore;
  /** Identity-guarded live→managed capture for the active account. */
  syncActiveBeforeRead?: ((accountId: string) => Promise<void>) | undefined;
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
    onCredentialRefreshed,
    provider,
    signal,
    stateStore,
    syncActiveBeforeRead,
    usageCache,
  } = options;
  const inflight = createInflightCoalescer();

  async function fetchForAccount(
    targetId: string
  ): Promise<AccountUsageResult> {
    const credential = await provider
      .readManagedCredentialRaw(accountHomeDir(targetId))
      .catch(() => null);
    if (!credential) {
      return {
        error: "This account's stored credential is missing",
        status: "error",
        windows: [],
      };
    }
    return await fetchClaudeUsage({
      credential,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      now,
      onCredentialRefreshed: (envelope) =>
        onCredentialRefreshed(targetId, envelope),
      signal,
    });
  }

  async function fetchWithActiveSync(
    targetId: string
  ): Promise<AccountUsageResult> {
    const isActive = stateStore.get().activeAccountId === targetId;
    if (isActive && syncActiveBeforeRead) {
      await syncActiveBeforeRead(targetId).catch(() => undefined);
    }
    let result = await fetchForAccount(targetId);
    // Active account only: the live store may hold a fresher rotation than
    // the managed copy — re-capture and retry once before reporting expiry.
    if (
      isActive &&
      syncActiveBeforeRead &&
      result.status === "error" &&
      result.error === LOGIN_EXPIRED_ERROR
    ) {
      await syncActiveBeforeRead(targetId).catch(() => undefined);
      result = await fetchForAccount(targetId);
    }
    return result;
  }

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

    await inflight.run(cacheKey, async () => {
      if (isDisposed()) {
        return;
      }
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
        if (!account) {
          return;
        }
        result = await fetchWithActiveSync(targetId);
      } else {
        result = {
          error: "No active Claude account",
          status: "error",
          windows: [],
        };
      }

      if (isDisposed()) {
        return;
      }
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
