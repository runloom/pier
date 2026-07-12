import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type {
  CodexAccountsSnapshot,
  CodexCostUsageSnapshot,
} from "../shared/accounts.ts";
import { LOGIN_TIMEOUT_MS } from "../shared/constants.ts";
import {
  buildAccountRecord,
  mergeIdentityIntoAccount,
} from "./accounts-records.ts";
import type {
  CodexAccountsService,
  CodexAccountsServiceOpts,
} from "./accounts-service-contract.ts";
import { buildAccountsSnapshot } from "./accounts-snapshot.ts";
import {
  activeUsageCacheKey,
  createUsageCacheEntry,
  USAGE_MIN_REFETCH_MS,
  USAGE_POLL_INTERVAL_MS,
  type UsageCacheEntry,
} from "./accounts-usage.ts";
import { PIER_MANAGED_HOME_MARKER } from "./codex-provider.ts";
import { migrateLegacyAccountsToState } from "./legacy-migration.ts";
import { classifyLoginError } from "./login-error.ts";
import {
  codexAccountHomeDir,
  ensureManagedAccountDir,
} from "./managed-account-home.ts";
import { reconcileManagedCredentials } from "./managed-credential-reconciliation.ts";
import { createSerialMutationQueue } from "./serial-mutation-queue.ts";
import type { AccountUsageResult } from "./types.ts";
import {
  createUsageRefreshScheduler,
  USAGE_REFRESH_CONCURRENCY,
} from "./usage-refresh-scheduler.ts";

const WATCH_SUPPRESS_MS = 1500;

export { SYSTEM_USAGE_CACHE_KEY } from "./accounts-usage.ts";
export { USAGE_REFRESH_CONCURRENCY } from "./usage-refresh-scheduler.ts";

export function createCodexAccountsService(
  opts: CodexAccountsServiceOpts
): CodexAccountsService {
  const { managedBaseDir, provider, stateStore, onChanged } = opts;
  const hasVisibleTarget = opts.hasVisibleTarget ?? (() => true);
  const ensureUsageEnv = opts.ensureUsageEnv ?? (() => Promise.resolve());

  let broadcastSeq = 0;
  let loginAbort: AbortController | null = null;
  let loginPending: "codex" | null = null;
  let watchDispose: (() => void) | null = null;
  const usageCache: Record<string, UsageCacheEntry> = {};
  let usagePollTimer: ReturnType<typeof setInterval> | null = null;
  let lastLoginError: { at: number; message: string } | null = null;
  let suppressWatchUntil = 0;
  let costUsage: CodexCostUsageSnapshot | null = null;

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
    return codexAccountHomeDir(managedBaseDir, accountId);
  }

  function buildSnapshot(): CodexAccountsSnapshot {
    broadcastSeq += 1;
    return {
      ...buildAccountsSnapshot({
        lastLoginError,
        loginPending,
        now: now(),
        revision: broadcastSeq,
        state: stateStore.get(),
        usageCache,
      }),
      costUsage,
    };
  }

  function emitSnapshot(): void {
    onChanged(buildSnapshot());
  }

  async function ensureManagedDir(accountId: string): Promise<string> {
    return await ensureManagedAccountDir(managedBaseDir, accountId);
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
      const identity = await provider.readIdentity(accountHomeDir(account.id));
      if (!identity) {
        throw new Error(
          `Migrated Codex credential is invalid for account ${account.id}`
        );
      }
    }
    if (result.activeAccountId) {
      suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
      await provider.materialize(accountHomeDir(result.activeAccountId));
      suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
    }
    await stateStore.flush();
    emitSnapshot();
    return true;
  }

  async function doAdd(): Promise<void> {
    const id = randomUUID();
    const dir = await ensureManagedDir(id);
    lastLoginError = null;
    loginPending = "codex";
    emitSnapshot();

    const abort = new AbortController();
    loginAbort = abort;
    let timedOut = false;
    const loginTimeout = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, LOGIN_TIMEOUT_MS);

    let failure: Error | null = null;
    const previousState = stateStore.get();
    let stateMutated = false;
    try {
      await provider.login(dir, abort.signal);
      const identity = await provider.readIdentity(dir);
      if (!identity) {
        throw new Error("Login completed but no identity found");
      }
      const state = previousState;
      const existing = identity.providerAccountId
        ? state.accounts.find(
            (a) => a.providerAccountId === identity.providerAccountId
          )
        : null;
      if (existing) {
        const existingDir = accountHomeDir(existing.id);
        if (provider.moveCredential) {
          await provider.moveCredential(dir, existingDir);
        } else {
          const freshAuth = await readFile(join(dir, "auth.json"), "utf-8");
          await writeFileAtomic(join(existingDir, "auth.json"), freshAuth, {
            mode: 0o600,
          });
        }
        await rm(dir, { recursive: true, force: true });
        if (stateStore.get().activeAccountId === existing.id) {
          suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
          await provider.materialize(existingDir);
          suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
        }
        stateStore.mutate((s) => ({
          ...s,
          accounts: s.accounts.map((a) =>
            a.id === existing.id
              ? mergeIdentityIntoAccount(a, identity, now(), now())
              : a
          ),
          revision: s.revision + 1,
        }));
        stateMutated = true;
      } else {
        const account = buildAccountRecord(identity, id, now(), now());
        stateStore.mutate((s) => ({
          ...s,
          accounts: [...s.accounts, account],
          revision: s.revision + 1,
        }));
        stateMutated = true;
      }
      await stateStore.flush();
      lastLoginError = null;
    } catch (err) {
      let rollbackError: unknown = null;
      if (stateMutated) {
        stateStore.mutate(() => previousState);
        try {
          await stateStore.flush();
        } catch (error) {
          rollbackError = error;
        }
      }
      await provider.deleteCredential?.(dir);
      await rm(dir, { recursive: true, force: true }).catch(() => {
        /* fire-and-forget */
      });
      const classified = classifyLoginError(err, {
        aborted: abort.signal.aborted,
        at: now(),
        timedOut,
      });
      lastLoginError = classified.errorState;
      failure = rollbackError
        ? new AggregateError(
            [classified.failure, rollbackError],
            "Codex account add and metadata rollback failed"
          )
        : classified.failure;
    } finally {
      clearTimeout(loginTimeout);
      loginAbort = null;
      loginPending = null;
      emitSnapshot();
    }
    if (failure) {
      throw failure;
    }
  }

  async function doSelect(accountId: string): Promise<void> {
    const state = stateStore.get();
    const target = state.accounts.find((a) => a.id === accountId);
    if (!target) {
      throw new Error(`Account not found: ${accountId}`);
    }
    if (state.activeAccountId === accountId) {
      return;
    }

    if (state.activeAccountId) {
      const activeAccount = state.accounts.find(
        (a) => a.id === state.activeAccountId
      );
      suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
      const syncResult = await provider.syncBack(
        accountHomeDir(state.activeAccountId),
        activeAccount?.providerAccountId
      );
      suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
      if (syncResult === "identity-mismatch") {
        await handleDrift();
      }
    }
    suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
    await provider.materialize(accountHomeDir(accountId));
    suppressWatchUntil = now() + WATCH_SUPPRESS_MS;

    stateStore.mutate((s) => ({
      ...s,
      activeAccountId: accountId,
      revision: s.revision + 1,
    }));
    await stateStore.flush();
    emitSnapshot();
    doRefreshUsage({ accountId, force: true }).catch(() => {
      /* fire-and-forget */
    });
  }

  async function doRemove(accountId: string): Promise<void> {
    const state = stateStore.get();
    if (state.activeAccountId === accountId) {
      throw new Error("Cannot remove active account — select another first");
    }
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
          "Codex account remove and metadata rollback failed"
        );
      }
      throw error;
    }
    const dir = accountHomeDir(accountId);
    const markerPath = join(dir, PIER_MANAGED_HOME_MARKER);
    if (existsSync(markerPath)) {
      await provider.deleteCredential?.(dir);
      await rm(dir, { recursive: true, force: true });
    }
    delete usageCache[accountId];
    emitSnapshot();
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
    usageCache[cacheKey] = createUsageCacheEntry(result, cached, now());
    emitSnapshot();
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
        const migrated = await enqueueMutation(migrateLegacyAccountsIfNeeded);
        if (!migrated && (await provider.readCurrentIdentity())) {
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
          /* fire-and-forget */
        });
      }, USAGE_POLL_INTERVAL_MS);
      if (hasVisibleTarget()) {
        refreshAllUsage().catch(() => {
          /* fire-and-forget */
        });
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
    setCostUsage(snapshot): void {
      costUsage = snapshot;
      emitSnapshot();
    },
    add: (_payload) => enqueueMutation(doAdd),
    cancelLogin: () => {
      loginAbort?.abort();
      return enqueueMutation(() => {
        loginAbort = null;
        loginPending = null;
        emitSnapshot();
        return Promise.resolve();
      });
    },
    select: (payload) => enqueueMutation(() => doSelect(payload.accountId)),
    remove: (payload) => enqueueMutation(() => doRemove(payload.accountId)),
    refreshUsage: (options) => doRefreshUsage(options),
    refreshAllUsage,
  };
}
