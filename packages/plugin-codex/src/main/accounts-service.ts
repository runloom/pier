import { randomUUID } from "node:crypto";
import {
  createUsageRefreshScheduler,
  startSuppressedDriftWatch,
  USAGE_REFRESH_CONCURRENCY,
} from "@pier/plugin-api/account-usage";
import type {
  CodexAccountsSnapshot,
  PeerSyncResult,
} from "../shared/accounts.ts";
import { addCodexAccount } from "./accounts-add.ts";
import {
  buildAccountRecord,
  mergeIdentityIntoAccount,
} from "./accounts-records.ts";
import { removeManagedAccount } from "./accounts-remove.ts";
import {
  selectManagedAccount,
  syncManagedAccountPeers,
} from "./accounts-select.ts";
import type {
  CodexAccountsService,
  CodexAccountsServiceOpts,
} from "./accounts-service-contract.ts";
import { buildAccountsSnapshot } from "./accounts-snapshot.ts";
import {
  USAGE_POLL_INTERVAL_MS,
  type UsageCacheEntry,
} from "./accounts-usage.ts";
import { createCodexUsageRefreshRunner } from "./accounts-usage-refresh.ts";
import { migrateLegacyAccountsToState } from "./legacy-migration.ts";
import { loginCancelledError } from "./login-error.ts";
import {
  codexAccountHomeDir,
  ensureManagedAccountDir,
} from "./managed-account-home.ts";
import { reconcileManagedCredentials } from "./managed-credential-reconciliation.ts";
import { createSerialMutationQueue } from "./serial-mutation-queue.ts";

const WATCH_SUPPRESS_MS = 1500;

export { USAGE_REFRESH_CONCURRENCY } from "@pier/plugin-api/account-usage";
export { SYSTEM_USAGE_CACHE_KEY } from "./accounts-usage.ts";

export function createCodexAccountsService(
  opts: CodexAccountsServiceOpts
): CodexAccountsService {
  const { managedBaseDir, provider, stateStore, onChanged } = opts;
  const hasVisibleTarget = opts.hasVisibleTarget ?? (() => true);
  const ensureUsageEnv = opts.ensureUsageEnv ?? (() => Promise.resolve());
  const logger = opts.logger;

  let disposed = false;
  let broadcastSeq = 0;
  let loginAbort: AbortController | null = null;
  let loginPending: "codex" | null = null;
  let loginStartedAt: number | null = null;
  let cancelGeneration = 0;
  let watchDispose: (() => void) | null = null;
  const credentialErrors = new Map<string, string>();
  const usageCache: Record<string, UsageCacheEntry> = {};
  let usagePollTimer: ReturnType<typeof setInterval> | null = null;
  let lastLoginError: { at: number; message: string } | null = null;
  let suppressWatchUntil = 0;
  // Service-level abort so dispose() can cancel in-flight usage fetches
  // instead of letting them write caches / emit events after deactivation.
  const usageAbort = new AbortController();

  const enqueueMutation = createSerialMutationQueue();
  let runUsageRefresh: ReturnType<typeof createCodexUsageRefreshRunner> | null =
    null;
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
    return codexAccountHomeDir(managedBaseDir, accountId);
  }

  function buildSnapshot(): CodexAccountsSnapshot {
    broadcastSeq += 1;
    return buildAccountsSnapshot({
      credentialErrors,
      lastLoginError,
      loginPending,
      loginStartedAt,
      now: now(),
      revision: broadcastSeq,
      state: stateStore.get(),
      usageCache,
    });
  }

  function emitSnapshot(): void {
    // A disposed instance must not broadcast: its (still counting) revision
    // sequence would make the renderer store reject the successor instance's
    // fresh snapshots.
    if (disposed) return;
    onChanged(buildSnapshot());
  }

  async function ensureManagedDir(accountId: string): Promise<string> {
    return await ensureManagedAccountDir(managedBaseDir, accountId);
  }

  /** Skip queued work that starts after the service was disposed. */
  function enqueueGuarded(operation: () => Promise<void>): Promise<void> {
    return enqueueMutation(() => {
      if (disposed) return Promise.resolve();
      return operation();
    });
  }

  async function doAdoptCurrent(): Promise<void> {
    const identity = await provider.readCurrentIdentity();
    if (!identity) {
      throw new Error("No valid codex login found at ~/.codex/auth.json");
    }
    const state = stateStore.get();
    const existing = identity.providerAccountId
      ? state.accounts.find(
          (a) => a.providerAccountId === identity.providerAccountId
        )
      : null;
    if (existing) {
      const dir = await ensureManagedDir(existing.id);
      // Pass the fingerprint parsed from the same file so an auth.json swap
      // between the identity read and the capture cannot bind the wrong
      // account's credentials.
      await provider.syncBack(dir, identity.providerAccountId);
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
      await provider.syncBack(dir, identity.providerAccountId);
      const account = buildAccountRecord(identity, id, now());
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

  async function migrateLegacyAccountsIfNeeded(): Promise<boolean> {
    const legacyMigration = opts.legacyMigration;
    const result = await migrateLegacyAccountsToState({
      ensureManagedDir,
      ...(legacyMigration ? { legacyMigration } : {}),
      now,
      stateStore,
    });
    if (!result.migrated) {
      return false;
    }
    for (const account of stateStore.get().accounts) {
      const identity = await provider
        .readIdentity(accountHomeDir(account.id))
        .catch(() => null);
      if (!identity) {
        // One broken migrated credential must not brick activation; mark
        // the account so the snapshot can surface it as errored.
        credentialErrors.set(
          account.id,
          "Migrated Codex credential is invalid"
        );
        logger?.warn(
          `[pier.codex] migrated credential is invalid for account ${account.id}`
        );
      }
    }
    if (
      result.activeAccountId &&
      !credentialErrors.has(result.activeAccountId)
    ) {
      suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
      await provider.materialize(accountHomeDir(result.activeAccountId));
      suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
    }
    await stateStore.flush();
    emitSnapshot();
    return true;
  }

  async function doAdd(abort: AbortController): Promise<void> {
    await addCodexAccount(
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
        setLoginAbort: (nextAbort) => {
          loginAbort = nextAbort;
        },
        setLoginPending: (pending) => {
          loginPending = pending;
        },
        setLoginStartedAt: (startedAt) => {
          loginStartedAt = startedAt;
        },
        setSuppressWatchUntil: (ts) => {
          suppressWatchUntil = ts;
        },
        stateStore,
        watchSuppressMs: WATCH_SUPPRESS_MS,
      },
      abort
    );
  }

  async function doSelect(
    accountId: string,
    syncTargets?: Parameters<typeof selectManagedAccount>[2]
  ): Promise<PeerSyncResult[]> {
    return await selectManagedAccount(
      {
        accountHomeDir,
        handleDrift,
        ...(logger ? { logger } : {}),
        now,
        onSelected: (selectedId) => {
          emitSnapshot();
          doRefreshUsage({ accountId: selectedId, force: true }).catch(() => {
            // 用量 error 经 snapshot 传播；此 catch 仅防 unhandled rejection。
          });
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
        ...(logger ? { logger } : {}),
        provider,
        stateStore,
      },
      payload
    );
  }

  async function doRemove(accountId: string): Promise<void> {
    await removeManagedAccount(
      {
        accountHomeDir,
        ...(logger ? { logger } : {}),
        onRemoved: (removedId) => {
          credentialErrors.delete(removedId);
          delete usageCache[removedId];
          emitSnapshot();
        },
        provider,
        stateStore,
      },
      accountId
    );
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
      // Removal race (refresh-all cycle vs remove): a vanished account is a
      // silent no-op, not an error that aborts the rest of the cycle.
      return;
    }
    if (!runUsageRefresh) {
      runUsageRefresh = createCodexUsageRefreshRunner({
        accountHomeDir,
        emitSnapshot,
        ensureUsageEnv,
        now,
        provider,
        signal: usageAbort.signal,
        stateStore,
        usageCache,
      });
    }
    await runUsageRefresh({
      ...(targetId ? { accountId: targetId } : {}),
      ...(options.force ? { force: true } : {}),
    });
  }

  async function handleDrift(): Promise<void> {
    const identity = await provider.readCurrentIdentity();
    if (!identity) {
      return;
    }
    const state = stateStore.get();
    const match = identity.providerAccountId
      ? state.accounts.find(
          (a) => a.providerAccountId === identity.providerAccountId
        )
      : null;
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
    watchDispose = startSuppressedDriftWatch({
      enqueueDriftCheck: enqueueGuarded,
      getSuppressUntil: () => suppressWatchUntil,
      handleDrift,
      isDisposed: () => disposed,
      now,
      watchExternalAuth: (callback) => provider.watchExternalAuth(callback),
    });
  }

  return {
    async init(): Promise<void> {
      await stateStore.init();
      const state = stateStore.get();
      if (state.accounts.length === 0) {
        // Best-effort: neither a failed migration nor a failed adoption may
        // brick activation (B1) — the accounts UI must stay reachable.
        const migrated = await enqueueMutation(
          migrateLegacyAccountsIfNeeded
        ).catch((error: unknown) => {
          logger?.warn("[pier.codex] legacy migration failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        });
        if (
          !migrated &&
          (await provider.readCurrentIdentity().catch(() => null))
        ) {
          await enqueueGuarded(doAdoptCurrent).catch((error: unknown) => {
            logger?.warn("[pier.codex] initial adoption failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      } else {
        const errors = await reconcileManagedCredentials({
          accounts: state.accounts,
          ensureManagedDir,
          ...(logger ? { logger } : {}),
          managedBaseDir,
          provider,
        });
        credentialErrors.clear();
        for (const [accountId, message] of errors) {
          credentialErrors.set(accountId, message);
        }
        await enqueueGuarded(handleDrift).catch((error: unknown) => {
          logger?.warn("[pier.codex] initial drift check failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      await stateStore.flush();
      await stateStore.ensureSchemaMarker();
      setupWatch();
      usagePollTimer = setInterval(() => {
        if (!hasVisibleTarget()) {
          return;
        }
        refreshAllUsage().catch(() => {
          // 用量 error 已通过 doRefreshUsage → usageCache → emitSnapshot 传播到 UI；
          // 此 catch 仅防 unhandled rejection，不面向用户。
        });
      }, USAGE_POLL_INTERVAL_MS);
      if (hasVisibleTarget()) {
        refreshAllUsage().catch(() => {
          // 同上：用量 error 经 snapshot 传播，此 catch 仅防 unhandled rejection。
        });
      }
    },
    dispose(): void {
      disposed = true;
      // Also clears the suppressed-recheck timer inside the drift watch.
      watchDispose?.();
      watchDispose = null;
      clearInterval(usagePollTimer ?? undefined);
      usagePollTimer = null;
      loginAbort?.abort();
      usageAbort.abort();
    },
    flush: () => stateStore.flush(),
    snapshot: () => buildSnapshot(),
    add: (_payload) => {
      // Created at enqueue time (not when the queued op starts) so a cancel
      // issued while the login is still queued is not lost.
      const abort = new AbortController();
      const generation = cancelGeneration;
      return enqueueMutation(() => {
        if (disposed || cancelGeneration !== generation) {
          throw loginCancelledError();
        }
        return doAdd(abort);
      });
    },
    adoptCurrent: () => enqueueGuarded(doAdoptCurrent),
    cancelLogin: () => {
      // Generation bump cancels the running login AND every queued add —
      // deliberate: cancel expresses "no pending login should proceed". A
      // queued add from another window is also cancelled (its renderer
      // treats the AbortError as expected cancellation).
      cancelGeneration += 1;
      loginAbort?.abort();
      return enqueueMutation(() => {
        loginAbort = null;
        loginPending = null;
        loginStartedAt = null;
        emitSnapshot();
        return Promise.resolve();
      });
    },
    select: (payload) =>
      enqueueMutation(() => {
        if (disposed) return Promise.resolve([]);
        return doSelect(payload.accountId, payload.syncTargets);
      }),
    syncToPeers: (payload) => enqueueGuarded(() => doSyncToPeers(payload)),
    remove: (payload) => enqueueGuarded(() => doRemove(payload.accountId)),
    refreshUsage: (options) => doRefreshUsage(options),
    refreshAllUsage,
  };
}
