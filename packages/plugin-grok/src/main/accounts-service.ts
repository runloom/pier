import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  createInflightCoalescer,
  createUsageRefreshScheduler,
  USAGE_REFRESH_CONCURRENCY,
} from "@pier/plugin-api/account-usage";
import type { AddAccountPayload } from "../shared/accounts.ts";
import { WATCH_SUPPRESS_MS } from "../shared/constants.ts";
import { addOidcAccount } from "./accounts-add-oidc.ts";
import {
  buildApiKeyAccountRecord,
  buildOidcAccountRecord,
  mergeIdentityIntoAccount,
} from "./accounts-records.ts";
import {
  selectManagedAccount,
  syncManagedAccountPeers,
} from "./accounts-select.ts";
import type {
  GrokAccountsService,
  GrokAccountsServiceOpts,
} from "./accounts-service-contract.ts";
import { buildAccountsSnapshot } from "./accounts-snapshot.ts";
import {
  activeUsageCacheKey,
  createUsageCacheEntry,
  USAGE_MIN_REFETCH_MS,
  USAGE_POLL_INTERVAL_MS,
  type UsageCacheEntry,
} from "./accounts-usage.ts";
import {
  ensureManagedAccountDir,
  grokAccountHomeDir,
  PIER_MANAGED_HOME_MARKER,
} from "./managed-account-home.ts";
import { reconcileManagedCredentials } from "./managed-credential-reconciliation.ts";
import { createSerialMutationQueue } from "./serial-mutation-queue.ts";
import type { AccountUsageResult } from "./types.ts";

export { USAGE_REFRESH_CONCURRENCY } from "@pier/plugin-api/account-usage";
export { SYSTEM_USAGE_CACHE_KEY } from "./accounts-usage.ts";

export function createGrokAccountsService(
  opts: GrokAccountsServiceOpts
): GrokAccountsService {
  const { managedBaseDir, provider, stateStore, onChanged } = opts;
  const hasVisibleTarget = opts.hasVisibleTarget ?? (() => true);

  let broadcastSeq = 0;
  let loginAbort: AbortController | null = null;
  let loginPending = false;
  let loginMode: "oauth" | "device" | null = null;
  let watchDispose: (() => void) | null = null;
  let lastLoginError: { at: number; message: string } | null = null;
  let suppressWatchUntil = 0;
  const usageCache: Record<string, UsageCacheEntry> = {};
  const usageRefreshInflight = createInflightCoalescer();
  let usagePollTimer: ReturnType<typeof setInterval> | null = null;

  const enqueueMutation = createSerialMutationQueue();
  const refreshAllUsage = createUsageRefreshScheduler({
    concurrency: USAGE_REFRESH_CONCURRENCY,
    getAccountIds: () => stateStore.get().accounts.map((account) => account.id),
    refreshAccount: (accountId, options) =>
      doRefreshUsage({ accountId, ...options }),
  });

  function now(): number {
    return Date.now();
  }

  function accountHomeDir(accountId: string): string {
    return grokAccountHomeDir(managedBaseDir, accountId);
  }

  function buildSnapshot() {
    broadcastSeq += 1;
    return buildAccountsSnapshot({
      lastLoginError,
      loginMode,
      loginPending,
      now: now(),
      revision: broadcastSeq,
      state: stateStore.get(),
      usageCache,
    });
  }

  function emitSnapshot(): void {
    onChanged(buildSnapshot());
  }

  async function ensureManagedDir(accountId: string): Promise<string> {
    return await ensureManagedAccountDir(managedBaseDir, accountId);
  }

  async function doRefreshUsage(
    options: { accountId?: string; force?: boolean } = {}
  ): Promise<void> {
    const state = stateStore.get();
    const targetId = options.accountId ?? state.activeAccountId;
    if (
      targetId &&
      !state.accounts.some((account) => account.id === targetId)
    ) {
      throw new Error(`Account not found: ${targetId}`);
    }
    const cacheKey = activeUsageCacheKey(targetId);
    const cached = usageCache[cacheKey];
    if (
      !options.force &&
      cached &&
      now() - cached.fetchedAt < USAGE_MIN_REFETCH_MS
    ) {
      return;
    }

    // Coalesce concurrent refresh for the same account (settings lease +
    // manual refresh + poll must not stampede multi-hop remote calls).
    await usageRefreshInflight.run(cacheKey, async () => {
      const latestCached = usageCache[cacheKey];
      if (
        !options.force &&
        latestCached &&
        now() - latestCached.fetchedAt < USAGE_MIN_REFETCH_MS
      ) {
        return;
      }

      let result: AccountUsageResult;
      if (targetId) {
        const account = stateStore
          .get()
          .accounts.find((entry) => entry.id === targetId);
        const abort = new AbortController();
        try {
          result = await provider.fetchUsage({
            kind: account?.kind === "api_key" ? "api_key" : "oidc",
            signal: abort.signal,
            ...(account?.kind === "api_key"
              ? {}
              : { accountHomeDir: accountHomeDir(targetId) }),
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

      usageCache[cacheKey] = createUsageCacheEntry(
        result,
        usageCache[cacheKey],
        now()
      );
      if (targetId && cacheKey !== targetId) {
        usageCache[targetId] = usageCache[cacheKey];
      }
      emitSnapshot();
    });
  }

  async function doAdoptCurrent(): Promise<void> {
    const identity = await provider.readCurrentIdentity();
    if (!identity) {
      throw new Error("No valid Grok login found at auth.json");
    }
    const state = stateStore.get();
    const existing = state.accounts.find(
      (a) => a.providerAccountId === identity.providerAccountId
    );
    if (existing) {
      const dir = await ensureManagedDir(existing.id);
      await provider.syncBack(dir, undefined);
      stateStore.mutate((s) => ({
        ...s,
        accounts: s.accounts.map((a) =>
          a.id === existing.id
            ? mergeIdentityIntoAccount(a, identity, now())
            : a
        ),
        activeAccountId: existing.id,
        revision: s.revision + 1,
      }));
    } else {
      const id = randomUUID();
      const dir = await ensureManagedDir(id);
      await provider.syncBack(dir, undefined);
      const account = buildOidcAccountRecord(identity, id, now());
      stateStore.mutate((s) => ({
        ...s,
        accounts: [...s.accounts, account],
        activeAccountId: id,
        revision: s.revision + 1,
      }));
    }
    await stateStore.flush();
    emitSnapshot();
    doRefreshUsage({ force: true }).catch(() => undefined);
  }

  async function doAddOidc(mode: "oauth" | "device"): Promise<void> {
    await addOidcAccount(
      {
        accountHomeDir,
        doRefreshUsage,
        emitSnapshot,
        ensureManagedDir,
        now,
        provider,
        setLastLoginError: (error) => {
          lastLoginError = error;
        },
        setLoginAbort: (abort) => {
          loginAbort = abort;
        },
        setLoginMode: (modeValue) => {
          loginMode = modeValue;
        },
        setLoginPending: (pending) => {
          loginPending = pending;
        },
        setSuppressWatchUntil: (ts) => {
          suppressWatchUntil = ts;
        },
        stateStore,
      },
      mode
    );
  }

  async function doAddApiKey(apiKey: string, label?: string): Promise<void> {
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) {
      throw new Error("API key must not be empty");
    }
    const id = randomUUID();
    const dir = await ensureManagedDir(id);
    const displayLabel =
      typeof label === "string" && label.trim().length > 0
        ? label.trim()
        : "API key";
    const previousState = stateStore.get();
    let stateMutated = false;
    try {
      await provider.storeApiKey(id, trimmed);
      const account = buildApiKeyAccountRecord(id, displayLabel, now());
      stateStore.mutate((s) => ({
        ...s,
        accounts: [...s.accounts, account],
        revision: s.revision + 1,
      }));
      stateMutated = true;
      if (stateStore.get().activeAccountId === null) {
        suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
        await provider.materializeEmptyAuth();
        suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
        stateStore.mutate((s) => ({
          ...s,
          activeAccountId: id,
          revision: s.revision + 1,
        }));
      }
      await stateStore.flush();
      lastLoginError = null;
      emitSnapshot();
      // Always refresh — even non-activated accounts need a cache entry to
      // leave the skeleton state. API keys return a known error result.
      doRefreshUsage({ accountId: id, force: true }).catch(() => undefined);
    } catch (error) {
      if (stateMutated) {
        stateStore.mutate(() => previousState);
        await stateStore.flush().catch(() => undefined);
      }
      await provider.deleteApiKey(id);
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function doAdd(payload: AddAccountPayload): Promise<void> {
    if ("kind" in payload && payload.kind === "api_key") {
      await doAddApiKey(payload.apiKey, payload.label);
      return;
    }
    const mode =
      "mode" in payload && payload.mode === "device" ? "device" : "oauth";
    await doAddOidc(mode);
  }

  async function doSelect(
    accountId: string,
    syncTargets?: Parameters<typeof selectManagedAccount>[2]
  ): Promise<void> {
    await selectManagedAccount(
      {
        accountHomeDir,
        handleDrift,
        ...(opts.logger ? { logger: opts.logger } : {}),
        now,
        onSelected: (selectedId) => {
          emitSnapshot();
          doRefreshUsage({ accountId: selectedId, force: true }).catch(
            () => undefined
          );
        },
        provider,
        setSuppressWatchUntil: (until) => {
          suppressWatchUntil = until;
        },
        stateStore,
        watchSuppressMs: WATCH_SUPPRESS_MS,
      },
      accountId,
      syncTargets
    );
  }

  async function doSyncToPeers(
    payload: Parameters<typeof syncManagedAccountPeers>[1]
  ): Promise<void> {
    await syncManagedAccountPeers(
      {
        accountHomeDir,
        ...(opts.logger ? { logger: opts.logger } : {}),
        provider,
        stateStore,
      },
      payload
    );
  }

  async function doRemove(accountId: string): Promise<void> {
    const state = stateStore.get();
    if (state.activeAccountId === accountId) {
      throw new Error("Cannot remove active account — select another first");
    }
    const account = state.accounts.find((a) => a.id === accountId);
    stateStore.mutate((s) => ({
      ...s,
      accounts: s.accounts.filter((a) => a.id !== accountId),
      revision: s.revision + 1,
    }));
    try {
      await stateStore.flush();
    } catch (error) {
      stateStore.mutate(() => state);
      try {
        await stateStore.flush();
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Grok account remove and metadata rollback failed"
        );
      }
      throw error;
    }
    const dir = accountHomeDir(accountId);
    const markerPath = join(dir, PIER_MANAGED_HOME_MARKER);
    if (existsSync(markerPath)) {
      if (account?.kind === "api_key") {
        await provider.deleteApiKey(accountId);
      } else {
        await provider.deleteCredential(dir);
      }
      await rm(dir, { recursive: true, force: true });
    }
    delete usageCache[accountId];
    emitSnapshot();
  }

  async function handleDrift(): Promise<void> {
    const identity = await provider.readCurrentIdentity();
    if (!identity) {
      return;
    }
    const state = stateStore.get();
    const match = state.accounts.find(
      (a) => a.providerAccountId === identity.providerAccountId
    );
    if (match) {
      if (state.activeAccountId !== match.id) {
        stateStore.mutate((s) => ({
          ...s,
          activeAccountId: match.id,
          revision: s.revision + 1,
        }));
      }
      await provider.syncBack(
        accountHomeDir(match.id),
        match.providerAccountId
      );
      await stateStore.flush();
    } else {
      await doAdoptCurrent();
      return;
    }
    emitSnapshot();
  }

  function setupWatch(): void {
    watchDispose = provider.watchExternalAuth(() => {
      if (now() < suppressWatchUntil) {
        return;
      }
      enqueueMutation(async () => {
        if (now() < suppressWatchUntil) {
          return;
        }
        await handleDrift();
      }).catch(() => {
        /* fire-and-forget */
      });
    });
  }

  return {
    async init(): Promise<void> {
      await stateStore.init();
      const state = stateStore.get();
      if (state.accounts.length === 0) {
        if (await provider.readCurrentIdentity()) {
          await enqueueMutation(doAdoptCurrent);
        }
      } else {
        await reconcileManagedCredentials({
          accounts: state.accounts,
          ensureManagedDir,
          managedBaseDir,
          provider,
        });
        await enqueueMutation(handleDrift);
      }
      await stateStore.flush();
      await stateStore.ensureSchemaMarker();
      setupWatch();
      usagePollTimer = setInterval(() => {
        if (!hasVisibleTarget()) {
          return;
        }
        refreshAllUsage().catch(() => {
          // Usage errors propagate via snapshot; swallow unhandled rejection.
        });
      }, USAGE_POLL_INTERVAL_MS);
      if (hasVisibleTarget()) {
        refreshAllUsage().catch(() => undefined);
      }
    },
    dispose(): void {
      watchDispose?.();
      watchDispose = null;
      clearInterval(usagePollTimer ?? undefined);
      usagePollTimer = null;
      loginAbort?.abort();
    },
    flush: () => stateStore.flush(),
    snapshot: () => buildSnapshot(),
    add: (payload) => enqueueMutation(() => doAdd(payload)),
    adoptCurrent: () => enqueueMutation(doAdoptCurrent),
    cancelLogin: () => {
      loginAbort?.abort();
      return enqueueMutation(() => {
        loginAbort = null;
        loginPending = false;
        loginMode = null;
        emitSnapshot();
        return Promise.resolve();
      });
    },
    select: (payload) =>
      enqueueMutation(() => doSelect(payload.accountId, payload.syncTargets)),
    syncToPeers: (payload) => enqueueMutation(() => doSyncToPeers(payload)),
    remove: (payload) => enqueueMutation(() => doRemove(payload.accountId)),
    refreshUsage: (options) => doRefreshUsage(options),
    refreshAllUsage,
  };
}
