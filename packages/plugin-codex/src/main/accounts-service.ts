import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type {
  AddAccountPayload,
  CodexAccountSummary,
  CodexAccountsSnapshot,
  RemoveAccountPayload,
  SelectAccountPayload,
} from "../shared/accounts.ts";
import {
  buildAccountRecord,
  mergeIdentityIntoAccount,
} from "./accounts-records.ts";
import {
  activeUsageCacheKey,
  toUsageSnapshot,
  USAGE_MIN_REFETCH_MS,
  USAGE_POLL_INTERVAL_MS,
  type UsageCacheEntry,
} from "./accounts-usage.ts";
import { PIER_MANAGED_HOME_MARKER } from "./codex-provider.ts";
import {
  type CodexLegacyMigrationAdapter,
  migrateLegacyAccountsToState,
} from "./legacy-migration.ts";
import { classifyLoginError } from "./login-error.ts";
import type { CodexAccountRecord, CodexAccountsStateStore } from "./state.ts";
import type { AgentAccountProvider } from "./types.ts";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const WATCH_SUPPRESS_MS = 1500;

// re-export: 测试与外部消费者从 service 入口取 usage 缓存键。
export { SYSTEM_USAGE_CACHE_KEY } from "./accounts-usage.ts";
export interface CodexAccountsServiceOpts {
  ensureUsageEnv?: () => Promise<void>;
  hasVisibleTarget?: () => boolean;
  legacyMigration?: CodexLegacyMigrationAdapter;
  managedBaseDir: string;
  onChanged: (snapshot: CodexAccountsSnapshot) => void;
  provider: AgentAccountProvider;
  stateStore: CodexAccountsStateStore;
}

export interface CodexAccountsService {
  add(payload: AddAccountPayload): Promise<void>;
  cancelLogin(): Promise<void>;
  dispose(): void;
  flush(): Promise<void>;
  init(): Promise<void>;
  refreshUsage(options?: {
    accountId?: string;
    force?: boolean;
  }): Promise<void>;
  remove(payload: RemoveAccountPayload): Promise<void>;
  select(payload: SelectAccountPayload): Promise<void>;
  snapshot(): CodexAccountsSnapshot;
}

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

  let mutationQueue: Promise<void> = Promise.resolve();

  function enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
    const task = mutationQueue.then(fn, fn);
    mutationQueue = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }

  function now(): number {
    return Date.now();
  }

  function accountHomeDir(accountId: string): string {
    return join(managedBaseDir, "codex", accountId);
  }

  function realCodexHome(): string {
    return process.env.CODEX_HOME ?? join(homedir(), ".codex");
  }

  function toSummary(record: CodexAccountRecord): CodexAccountSummary {
    const usage = usageCache[record.id];
    return {
      id: record.id,
      label: record.email ?? record.id,
      ...(record.planType ? { planType: record.planType } : {}),
      status:
        record.id === stateStore.get().activeAccountId ? "active" : "available",
      usage: usage ? toUsageSnapshot(usage) : null,
      error:
        lastLoginError && loginPending === null ? lastLoginError.message : null,
    };
  }

  function buildSnapshot(): CodexAccountsSnapshot {
    broadcastSeq += 1;
    const state = stateStore.get();
    const cacheKey = activeUsageCacheKey(state.activeAccountId);
    const activeUsageEntry = usageCache[cacheKey];
    return {
      accounts: state.accounts.map(toSummary),
      activeAccountId: state.activeAccountId,
      activeUsage: activeUsageEntry ? toUsageSnapshot(activeUsageEntry) : null,
      login: loginPending ? { provider: "codex", startedAt: now() } : null,
      revision: broadcastSeq,
      schemaVersion: state.schemaVersion,
    };
  }

  function emitSnapshot(): void {
    onChanged(buildSnapshot());
  }

  async function ensureManagedDir(accountId: string): Promise<string> {
    const dir = accountHomeDir(accountId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, PIER_MANAGED_HOME_MARKER), "", { mode: 0o600 });
    return dir;
  }

  async function doAdoptCurrent(): Promise<void> {
    const identity = await provider.readIdentity(realCodexHome());
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
    try {
      await provider.login(dir, abort.signal);
      const identity = await provider.readIdentity(dir);
      if (!identity) {
        throw new Error("Login completed but no identity found");
      }
      const state = stateStore.get();
      const existing = identity.providerAccountId
        ? state.accounts.find(
            (a) => a.providerAccountId === identity.providerAccountId
          )
        : null;
      if (existing) {
        const existingDir = accountHomeDir(existing.id);
        const freshAuth = await readFile(join(dir, "auth.json"), "utf-8");
        await writeFileAtomic(join(existingDir, "auth.json"), freshAuth, {
          mode: 0o600,
        });
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
      } else {
        const account = buildAccountRecord(identity, id, now(), now());
        stateStore.mutate((s) => ({
          ...s,
          accounts: [...s.accounts, account],
          revision: s.revision + 1,
        }));
      }
      lastLoginError = null;
    } catch (err) {
      await rm(dir, { recursive: true, force: true }).catch(() => {
        /* fire-and-forget */
      });
      const classified = classifyLoginError(err, {
        aborted: abort.signal.aborted,
        at: now(),
        timedOut,
      });
      lastLoginError = classified.errorState;
      failure = classified.failure;
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
    const dir = accountHomeDir(accountId);
    const markerPath = join(dir, PIER_MANAGED_HOME_MARKER);
    if (existsSync(markerPath)) {
      await rm(dir, { recursive: true, force: true });
    }
    stateStore.mutate((s) => ({
      ...s,
      accounts: s.accounts.filter((a) => a.id !== accountId),
      revision: s.revision + 1,
    }));
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
    const result = await provider.fetchUsage(
      targetId ? accountHomeDir(targetId) : undefined,
      abort.signal
    );
    usageCache[cacheKey] = {
      fetchedAt: now(),
      raw: result,
      status: result.status,
      ...(result.error ? { error: result.error } : {}),
      ...(result.session ? { session: result.session } : {}),
      ...(result.weekly ? { weekly: result.weekly } : {}),
    };
    emitSnapshot();
  }

  async function handleDrift(): Promise<void> {
    const identity = await provider.readIdentity(realCodexHome());
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
        if (!migrated && (await provider.readIdentity(realCodexHome()))) {
          await enqueueMutation(doAdoptCurrent);
        }
      } else {
        await enqueueMutation(handleDrift);
      }
      setupWatch();
      usagePollTimer = setInterval(() => {
        if (!hasVisibleTarget()) {
          return;
        }
        doRefreshUsage().catch(() => {
          /* fire-and-forget */
        });
      }, USAGE_POLL_INTERVAL_MS);
      doRefreshUsage().catch(() => {
        /* fire-and-forget */
      });
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
  };
}
