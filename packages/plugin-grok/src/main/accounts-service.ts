import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  createUsageRefreshScheduler,
  startSuppressedDriftWatch,
  USAGE_REFRESH_CONCURRENCY,
} from "@pier/plugin-api/account-usage";
import type { AddAccountPayload, PeerSyncResult } from "../shared/accounts.ts";
import { WATCH_SUPPRESS_MS } from "../shared/constants.ts";
import { addApiKeyAccount } from "./accounts-add-api-key.ts";
import { addOidcAccount } from "./accounts-add-oidc.ts";
import {
  buildOidcAccountRecord,
  mergeIdentityIntoAccount,
} from "./accounts-records.ts";
import { removeManagedAccount } from "./accounts-remove.ts";
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
  USAGE_POLL_INTERVAL_MS,
  type UsageCacheEntry,
} from "./accounts-usage.ts";
import { createGrokUsageRefreshRunner } from "./accounts-usage-refresh.ts";
import type { DeviceLoginInfo } from "./device-login-output.ts";
import { loginCancelledError } from "./login-error.ts";
import {
  ensureManagedAccountDir,
  grokAccountHomeDir,
} from "./managed-account-home.ts";
import { reconcileManagedCredentials } from "./managed-credential-reconciliation.ts";
import { createSerialMutationQueue } from "./serial-mutation-queue.ts";

export { USAGE_REFRESH_CONCURRENCY } from "@pier/plugin-api/account-usage";
export { SYSTEM_USAGE_CACHE_KEY } from "./accounts-usage.ts";

export function createGrokAccountsService(
  opts: GrokAccountsServiceOpts
): GrokAccountsService {
  const { managedBaseDir, provider, stateStore, onChanged } = opts;
  const hasVisibleTarget = opts.hasVisibleTarget ?? (() => true);
  const logger = opts.logger;

  let disposed = false;
  let broadcastSeq = 0;
  let loginAbort: AbortController | null = null;
  let loginPending = false;
  let loginMode: "oauth" | "device" | null = null;
  let loginStartedAt: number | null = null;
  let loginDeviceInfo: DeviceLoginInfo | null = null;
  let cancelGeneration = 0;
  let watchDispose: (() => void) | null = null;
  let lastLoginError: { at: number; message: string } | null = null;
  let suppressWatchUntil = 0;
  const credentialErrors = new Map<string, string>();
  const usageCache: Record<string, UsageCacheEntry> = {};
  // Service-level abort so dispose() can cancel in-flight usage fetches
  // instead of letting them write caches / emit events after deactivation.
  const usageAbort = new AbortController();
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
      credentialErrors,
      lastLoginError,
      loginDeviceInfo,
      loginMode,
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

  /**
   * Mirror a refreshed OIDC session into the real Grok home when the account
   * is active there. Without this, a rotated (possibly single-use) refresh
   * token lives only in the plugin store and the CLI's own copy goes stale.
   *
   * Runs on the mutation queue and re-verifies the active account *inside*
   * the queued operation: usage refresh is not serialized with `select`, so
   * checking outside the queue could interleave with a switch and write the
   * old account's session over the newly materialized one.
   */
  function mirrorRefreshedSessionToRealHome(
    accountId: string,
    authJson: string
  ): Promise<void> {
    return enqueueGuarded(async () => {
      if (stateStore.get().activeAccountId !== accountId) return;
      const account = stateStore
        .get()
        .accounts.find((entry) => entry.id === accountId);
      if (account?.kind !== "oidc") return;
      try {
        const currentIdentity = await provider.readCurrentIdentity();
        // Only overwrite the real home when it still belongs to this account —
        // an external login must never be clobbered by our refresh.
        if (
          currentIdentity &&
          currentIdentity.providerAccountId !== account.providerAccountId
        ) {
          return;
        }
        suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
        await provider.writeCurrentAuthContent(authJson);
        suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
      } catch (error) {
        logger?.warn(
          "[pier.grok] could not mirror refreshed session to real home",
          { error: error instanceof Error ? error.message : String(error) }
        );
      }
    });
  }

  const doRefreshUsage = createGrokUsageRefreshRunner({
    accountHomeDir,
    emitSnapshot,
    isDisposed: () => disposed,
    now,
    onSessionRefreshed: (accountId, authJson) =>
      mirrorRefreshedSessionToRealHome(accountId, authJson),
    provider,
    signal: usageAbort.signal,
    stateStore,
    usageCache,
  });

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
      const syncResult = await provider.syncBack(
        dir,
        identity.providerAccountId
      );
      if (syncResult === "identity-mismatch") {
        // The external login changed between reads; the watcher will fire
        // again for the new content.
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        return;
      }
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

  async function doAddOidc(
    mode: "oauth" | "device",
    abort: AbortController
  ): Promise<void> {
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
        setLoginAbort: (nextAbort) => {
          loginAbort = nextAbort;
        },
        setLoginDeviceInfo: (info) => {
          loginDeviceInfo = info;
        },
        setLoginMode: (modeValue) => {
          loginMode = modeValue;
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
      },
      mode,
      abort
    );
  }

  async function doAdd(
    payload: AddAccountPayload,
    abort: AbortController
  ): Promise<void> {
    if ("kind" in payload && payload.kind === "api_key") {
      await addApiKeyAccount(
        {
          adoptCurrent: doAdoptCurrent,
          clearLastLoginError: () => {
            lastLoginError = null;
          },
          doRefreshUsage,
          emitSnapshot,
          ensureManagedDir,
          ...(logger ? { logger } : {}),
          now,
          provider,
          setSuppressWatchUntil: (ts) => {
            suppressWatchUntil = ts;
          },
          stateStore,
        },
        payload.apiKey,
        payload.label
      );
      return;
    }
    const mode =
      "mode" in payload && payload.mode === "device" ? "device" : "oauth";
    await doAddOidc(mode, abort);
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
        if (await provider.readCurrentIdentity().catch(() => null)) {
          // Best-effort: a failed adoption (e.g. syncBack IO error) must not
          // brick activation — the watcher retries on the next auth change.
          await enqueueGuarded(doAdoptCurrent).catch((error: unknown) => {
            logger?.warn("[pier.grok] initial adoption failed", {
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
          logger?.warn("[pier.grok] initial drift check failed", {
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
          // Usage errors propagate via snapshot; swallow unhandled rejection.
        });
      }, USAGE_POLL_INTERVAL_MS);
      if (hasVisibleTarget()) {
        refreshAllUsage().catch(() => undefined);
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
    add: (payload) => {
      // Created at enqueue time (not when the queued op starts) so a cancel
      // issued while the login is still queued is not lost.
      const abort = new AbortController();
      const generation = cancelGeneration;
      return enqueueMutation(() => {
        if (disposed || cancelGeneration !== generation) {
          throw loginCancelledError();
        }
        return doAdd(payload, abort);
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
        loginPending = false;
        loginMode = null;
        loginStartedAt = null;
        loginDeviceInfo = null;
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
