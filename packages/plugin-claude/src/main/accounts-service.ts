import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  createUsageRefreshScheduler,
  startSuppressedDriftWatch,
  USAGE_POLL_INTERVAL_MS,
  USAGE_REFRESH_CONCURRENCY,
} from "@pier/plugin-api/account-usage";
import type { ClaudeAccountsSnapshot } from "../shared/accounts.ts";
import { WATCH_SUPPRESS_MS } from "../shared/constants.ts";
import { createOauthLoginController } from "./accounts-login.ts";
import {
  buildAccountRecord,
  mergeIdentityIntoAccount,
} from "./accounts-records.ts";
import { removeManagedAccount } from "./accounts-remove.ts";
import { selectManagedAccount } from "./accounts-select.ts";
import type {
  ClaudeAccountsService,
  ClaudeAccountsServiceOpts,
} from "./accounts-service-contract.ts";
import { buildAccountsSnapshot } from "./accounts-snapshot.ts";
import {
  createClaudeUsageRefreshRunner,
  createRotatedCredentialPersister,
  type UsageCacheEntry,
} from "./accounts-usage-refresh.ts";
import {
  claudeAccountHomeDir,
  ensureManagedAccountDir,
} from "./managed-account-home.ts";
import { reconcileManagedCredentials } from "./managed-credential-reconciliation.ts";
import { parseCredentialEnvelope } from "./oauth.ts";
import { createSerialMutationQueue } from "./serial-mutation-queue.ts";

function loginCancelledError(): Error {
  const error = new Error("Login cancelled");
  error.name = "AbortError";
  return error;
}

export function createClaudeAccountsService(
  opts: ClaudeAccountsServiceOpts
): ClaudeAccountsService {
  const { managedBaseDir, provider, stateStore, onChanged } = opts;
  const hasVisibleTarget = opts.hasVisibleTarget ?? (() => true);
  const logger = opts.logger;

  let disposed = false;
  let broadcastSeq = 0;
  let watchDispose: (() => void) | null = null;
  let lastActionError: { at: number; message: string } | null = null;
  let suppressWatchUntil = 0;
  let cancelGeneration = 0;
  let apiKeyModeDetected = false;
  const credentialErrors = new Map<string, string>();
  const usageCache: Record<string, UsageCacheEntry> = {};
  // Service-level abort so dispose() can cancel in-flight usage fetches.
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
    return claudeAccountHomeDir(managedBaseDir, accountId);
  }

  function buildSnapshot(): ClaudeAccountsSnapshot {
    broadcastSeq += 1;
    return buildAccountsSnapshot({
      apiKeyModeDetected,
      credentialErrors,
      lastActionError,
      login: login.loginState(),
      revision: broadcastSeq,
      state: stateStore.get(),
      usageCache,
    });
  }

  /** Refresh the API-key-mode signal (cheap: env + one ~/.claude.json read). */
  async function refreshApiKeyMode(): Promise<void> {
    const detected = await provider.detectApiKeyMode().catch(() => false);
    if (detected !== apiKeyModeDetected) {
      apiKeyModeDetected = detected;
      emitSnapshot();
    }
  }

  function emitSnapshot(): void {
    if (disposed) {
      return;
    }
    onChanged(buildSnapshot());
  }

  async function ensureManagedDir(accountId: string): Promise<string> {
    return await ensureManagedAccountDir(managedBaseDir, accountId);
  }

  function enqueueGuarded(operation: () => Promise<void>): Promise<void> {
    return enqueueMutation(() => {
      if (disposed) {
        return Promise.resolve();
      }
      return operation();
    });
  }

  const persistRotatedCredential = createRotatedCredentialPersister({
    accountHomeDir,
    enqueueMirror: enqueueGuarded,
    ...(logger ? { logger } : {}),
    now,
    provider,
    setSuppressWatchUntil: (until) => {
      suppressWatchUntil = until;
    },
    stateStore,
    watchSuppressMs: WATCH_SUPPRESS_MS,
  });

  /**
   * Identity-guarded freshness sync for the active account before a usage
   * read. Claude Code rotates its Keychain credential without any watchable
   * file change, so the live store is usually the freshest copy — but after
   * a Pier-side rotation whose active-store mirror failed, the MANAGED copy
   * is the fresher one, and capturing live→managed would destroy the only
   * valid (single-use) refresh token. Compare `expiresAt` and sync in
   * whichever direction preserves the newest rotation.
   */
  async function syncActiveBeforeRead(accountId: string): Promise<void> {
    const state = stateStore.get();
    if (state.activeAccountId !== accountId) {
      return;
    }
    const account = state.accounts.find((entry) => entry.id === accountId);
    if (account?.providerAccountId === undefined) {
      return;
    }
    const dir = accountHomeDir(accountId);
    const [managedRaw, liveRaw, liveIdentity] = await Promise.all([
      provider.readManagedCredentialRaw(dir).catch(() => null),
      provider.readCurrentCredentialRaw().catch(() => null),
      provider.readCurrentIdentity().catch(() => null),
    ]);
    if (
      liveIdentity &&
      liveIdentity.providerAccountId !== account.providerAccountId
    ) {
      // Foreign external login — drift handling owns this, not usage sync.
      return;
    }
    const managedExpiresAt = managedRaw
      ? parseCredentialEnvelope(managedRaw)?.expiresAt
      : undefined;
    const liveParsed = liveRaw ? parseCredentialEnvelope(liveRaw) : null;
    if (
      managedRaw &&
      // A logged-out live store (null) stays logged out, and non-OAuth live
      // content (API-key-mode installs) is never overwritten by a background
      // usage read — the heal contract only covers a stale OAuth envelope
      // left behind by a failed mirror.
      liveRaw !== null &&
      liveParsed !== null &&
      managedExpiresAt !== undefined &&
      (liveParsed.expiresAt === undefined ||
        managedExpiresAt > liveParsed.expiresAt)
    ) {
      // Managed copy is fresher (earlier mirror failed): heal the live store
      // instead of capturing the stale live envelope over the fresh one.
      suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
      await provider
        .writeCurrentCredentialRaw(managedRaw)
        .catch(() => undefined);
      suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
      return;
    }
    await provider.syncBack(dir, account.providerAccountId);
  }

  const doRefreshUsage = createClaudeUsageRefreshRunner({
    accountHomeDir,
    emitSnapshot,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    isDisposed: () => disposed,
    now,
    onCredentialRefreshed: persistRotatedCredential,
    provider,
    signal: usageAbort.signal,
    stateStore,
    syncActiveBeforeRead,
    usageCache,
  });

  /**
   * Import the current Claude login into managed accounts and activate it
   * (the CLI-import add path; the OAuth add path is completeLogin).
   */
  async function doAdoptCurrent(): Promise<void> {
    const identity = await provider.readCurrentIdentity();
    if (!identity) {
      throw new Error(
        "No valid Claude login found. Sign in with the Claude CLI first."
      );
    }
    lastActionError = null;
    const state = stateStore.get();
    const existing = state.accounts.find(
      (a) => a.providerAccountId === identity.providerAccountId
    );
    if (existing) {
      const dir = await ensureManagedDir(existing.id);
      const syncResult = await provider.syncBack(
        dir,
        identity.providerAccountId
      );
      if (syncResult !== "ok") {
        throw new Error("Could not capture the current Claude credential");
      }
      credentialErrors.delete(existing.id);
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
      if (syncResult !== "ok") {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        throw new Error("Could not capture the current Claude credential");
      }
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

  const login = createOauthLoginController({
    completeDeps: {
      accountHomeDir,
      ensureManagedDir,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      materialize: async (accountId) => {
        suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
        await provider.materialize(accountHomeDir(accountId));
        suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
        stateStore.mutate((current) => ({
          ...current,
          activeAccountId: accountId,
          revision: current.revision + 1,
        }));
        await stateStore.flush();
      },
      now,
      provider,
      stateStore,
    },
    emitSnapshot,
    now,
    setLastActionError: (error) => {
      lastActionError = error;
    },
    setSuppressWatchUntil: (until) => {
      suppressWatchUntil = until;
    },
  });

  async function doCompleteLogin(code: string): Promise<void> {
    await login.complete(code);
    doRefreshUsage({ force: true }).catch(() => undefined);
  }

  async function doSelect(accountId: string): Promise<void> {
    await selectManagedAccount(
      {
        accountHomeDir,
        handleDrift,
        ...(logger ? { logger } : {}),
        now,
        onSelected: (selectedId) => {
          lastActionError = null;
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
      accountId
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
          lastActionError = null;
          emitSnapshot();
        },
        provider,
        stateStore,
      },
      accountId
    );
  }

  /**
   * External `/login` / `/logout` drift: adopt the new active login when it
   * matches a managed account (or is brand new); otherwise leave state as-is.
   */
  async function handleDrift(): Promise<void> {
    // .claude.json changed — the API-key-mode signal may have too.
    await refreshApiKeyMode();
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
      const dir = await ensureManagedDir(match.id);
      const syncResult = await provider.syncBack(dir, match.providerAccountId);
      // Only clear a stored credential error once the capture verifiably
      // succeeded; a raced logout/login must not mask a stale credential.
      if (syncResult === "ok") {
        credentialErrors.delete(match.id);
      }
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

  function withActionError<T>(operation: () => Promise<T>): () => Promise<T> {
    return async () => {
      try {
        return await operation();
      } catch (error) {
        lastActionError = {
          at: now(),
          message: error instanceof Error ? error.message : String(error),
        };
        emitSnapshot();
        throw error;
      }
    };
  }

  return {
    async init(): Promise<void> {
      await stateStore.init();
      apiKeyModeDetected = await provider.detectApiKeyMode().catch(() => false);
      const state = stateStore.get();
      if (state.accounts.length > 0) {
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
          logger?.warn("[pier.claude] initial drift check failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      } else if (await provider.readCurrentIdentity().catch(() => null)) {
        await enqueueGuarded(doAdoptCurrent).catch((error: unknown) => {
          logger?.warn("[pier.claude] initial adoption failed", {
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
      watchDispose?.();
      watchDispose = null;
      clearInterval(usagePollTimer ?? undefined);
      usagePollTimer = null;
      login.dispose();
      usageAbort.abort();
    },
    flush: () => stateStore.flush(),
    snapshot: () => buildSnapshot(),
    add: (payload) => {
      if (payload?.kind === "import") {
        return enqueueGuarded(withActionError(doAdoptCurrent));
      }
      const generation = cancelGeneration;
      return enqueueMutation(() => {
        if (disposed || cancelGeneration !== generation) {
          throw loginCancelledError();
        }
        login.start();
        return Promise.resolve();
      });
    },
    adoptCurrent: () => enqueueGuarded(withActionError(doAdoptCurrent)),
    cancelLogin: () => {
      cancelGeneration += 1;
      login.dispose();
      return enqueueMutation(() => {
        login.cancel();
        emitSnapshot();
        return Promise.resolve();
      });
    },
    completeLogin: (payload) =>
      enqueueGuarded(() => doCompleteLogin(payload.code)),
    select: (payload) =>
      enqueueGuarded(withActionError(() => doSelect(payload.accountId))),
    remove: (payload) =>
      enqueueGuarded(withActionError(() => doRemove(payload.accountId))),
    refreshUsage: (options) =>
      doRefreshUsage({
        ...(options?.accountId ? { accountId: options.accountId } : {}),
        ...(options?.force === undefined ? {} : { force: options.force }),
      }),
    refreshAllUsage,
  };
}
