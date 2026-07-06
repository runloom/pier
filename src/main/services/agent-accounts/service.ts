import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AccountUsage,
  AgentAccount,
  AgentAccountsSnapshot,
} from "@shared/contracts/agent-accounts.ts";
import writeFileAtomic from "write-file-atomic";
import type { AgentAccountsStateStore } from "../../state/agent-accounts-state.ts";
import { PIER_MANAGED_HOME_MARKER } from "./codex-provider.ts";
import type { AccountUsageResult, AgentAccountProvider } from "./types.ts";

const USAGE_MIN_REFETCH_MS = 5 * 60 * 1000; // 5min
const USAGE_POLL_INTERVAL_MS = 15 * 60 * 1000; // 15min
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5min
/** 物化/回采后的 watch suppress 窗口（ms）。需覆盖 watcher 的 500ms debounce 尾巴。 */
const WATCH_SUPPRESS_MS = 1500;

export interface AgentAccountsServiceOpts {
  broadcast: (snapshot: AgentAccountsSnapshot) => void;
  /** 是否有可见窗口——轮询 tick 前检查；缺省 () => true。 */
  hasVisibleTarget?: () => boolean;
  managedBaseDir: string;
  provider: AgentAccountProvider;
  stateStore: AgentAccountsStateStore;
}

export interface AgentAccountsService {
  add(provider: string): Promise<void>;
  adoptCurrent(): Promise<void>;
  cancelLogin(provider: string): Promise<void>;
  dispose(): void;
  init(): Promise<void>;
  refreshUsage(force?: boolean): Promise<void>;
  remove(accountId: string): Promise<void>;
  select(accountId: string): Promise<void>;
  snapshot(): AgentAccountsSnapshot;
}

export function createAgentAccountsService(
  opts: AgentAccountsServiceOpts
): AgentAccountsService {
  const { broadcast, managedBaseDir, provider, stateStore } = opts;
  const hasVisibleTarget = opts.hasVisibleTarget ?? (() => true);

  let broadcastSeq = 0;
  let loginAbort: AbortController | null = null;
  let loginPending: "codex" | null = null;
  let watchDispose: (() => void) | null = null;
  const usageCache: Record<string, AccountUsage> = {};
  let usagePollTimer: ReturnType<typeof setInterval> | null = null;
  let lastLoginError: { at: number; message: string } | null = null;
  let suppressWatchUntil = 0;

  // mutation queue 串行化
  let mutationQueue: Promise<void> = Promise.resolve();

  function enqueueMutation(fn: () => Promise<void>): Promise<void> {
    const task = mutationQueue.then(fn, fn);
    mutationQueue = task.catch(() => {
      /* keep chain alive */
    });
    return task;
  }

  function now(): number {
    return Date.now();
  }

  function accountHomeDir(accountId: string): string {
    return join(managedBaseDir, "codex", accountId);
  }

  /** 真实 ~/.codex 路径（adopt/drift 侦测用）。 */
  function realCodexHome(): string {
    return process.env.CODEX_HOME ?? join(homedir(), ".codex");
  }

  function buildSnapshot(): AgentAccountsSnapshot {
    broadcastSeq += 1;
    const state = stateStore.get();
    return {
      accounts: state.accounts,
      activeAccountId: state.activeAccountId,
      lastLoginError,
      loginPending,
      ts: broadcastSeq,
      usage: { ...usageCache },
    };
  }

  function emitSnapshot(): void {
    broadcast(buildSnapshot());
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
      // 幂等：更新凭据+身份，激活
      const dir = await ensureManagedDir(existing.id);
      await provider.syncBack(dir, undefined);
      stateStore.mutate((s) => ({
        ...s,
        accounts: s.accounts.map((a) =>
          a.id === existing.id
            ? {
                ...a,
                email: identity.email,
                planType: identity.planType,
                providerAccountId: identity.providerAccountId,
                updatedAt: now(),
              }
            : a
        ),
        activeAccountId: existing.id,
      }));
    } else {
      const id = randomUUID();
      const dir = await ensureManagedDir(id);
      await provider.syncBack(dir, undefined);
      const account: AgentAccount = {
        createdAt: now(),
        email: identity.email,
        id,
        planType: identity.planType,
        provider: "codex",
        providerAccountId: identity.providerAccountId,
        updatedAt: now(),
      };
      stateStore.mutate((s) => ({
        ...s,
        accounts: [...s.accounts, account],
        activeAccountId: id,
      }));
    }
    emitSnapshot();
  }

  async function doAdd(): Promise<void> {
    const id = randomUUID();
    const dir = await ensureManagedDir(id);
    lastLoginError = null;
    loginPending = "codex";
    emitSnapshot();

    const abort = new AbortController();
    loginAbort = abort;

    const loginTimeout = setTimeout(() => abort.abort(), LOGIN_TIMEOUT_MS);

    try {
      await provider.login(dir, abort.signal);
      const identity = await provider.readIdentity(dir);
      if (!identity) {
        throw new Error("Login completed but no identity found");
      }
      // 按 providerAccountId 去重
      const state = stateStore.get();
      const existing = identity.providerAccountId
        ? state.accounts.find(
            (a) => a.providerAccountId === identity.providerAccountId
          )
        : null;

      if (existing) {
        // re-auth 语义：把新凭据复制到既有账号托管目录，清理临时目录
        const existingDir = accountHomeDir(existing.id);
        // 与 materialize 同等保证：原子写 + 0600（copyFile 非原子且继承源权限）。
        const freshAuth = await readFile(join(dir, "auth.json"), "utf-8");
        await writeFileAtomic(join(existingDir, "auth.json"), freshAuth, {
          mode: 0o600,
        });
        await rm(dir, { recursive: true, force: true });
        stateStore.mutate((s) => ({
          ...s,
          accounts: s.accounts.map((a) =>
            a.id === existing.id
              ? {
                  ...a,
                  email: identity.email,
                  lastAuthenticatedAt: now(),
                  planType: identity.planType,
                  providerAccountId: identity.providerAccountId,
                  updatedAt: now(),
                }
              : a
          ),
        }));
      } else {
        const account: AgentAccount = {
          createdAt: now(),
          email: identity.email,
          id,
          lastAuthenticatedAt: now(),
          planType: identity.planType,
          provider: "codex",
          providerAccountId: identity.providerAccountId,
          updatedAt: now(),
        };
        stateStore.mutate((s) => ({
          ...s,
          accounts: [...s.accounts, account],
        }));
      }
      lastLoginError = null;
    } catch (err) {
      // 登录失败/取消/超时/readIdentity 返回 null——清理临时目录
      await rm(dir, { recursive: true, force: true }).catch(() => {
        /* cleanup best-effort */
      });
      // 分类错误：AbortError（取消）不设错误状态
      if (err instanceof Error && err.name === "AbortError") {
        // 用户取消——静默
      } else if (
        err instanceof Error &&
        abort.signal.aborted &&
        err.name !== "AbortError"
      ) {
        lastLoginError = {
          at: now(),
          message: "Login timed out after 5 minutes",
        };
      } else {
        lastLoginError = {
          at: now(),
          message: err instanceof Error ? err.message : String(err),
        };
      }
    } finally {
      clearTimeout(loginTimeout);
      loginAbort = null;
      loginPending = null;
      emitSnapshot();
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

    // 时序铁律：先 syncBack 再 materialize
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
        // 外部已换号：走漂移处理后中止本次切换
        await handleDrift();
        return;
      }
    }

    suppressWatchUntil = now() + WATCH_SUPPRESS_MS;
    await provider.materialize(accountHomeDir(accountId));
    suppressWatchUntil = now() + WATCH_SUPPRESS_MS;

    stateStore.mutate((s) => ({
      ...s,
      activeAccountId: accountId,
    }));
    emitSnapshot();
    // 切换成功后刷新用量（force 绕过防抖，失败不阻断切换）
    doRefreshUsage(true).catch(() => {
      /* fire-and-forget */
    });
  }

  async function doRemove(accountId: string): Promise<void> {
    const state = stateStore.get();
    if (state.activeAccountId === accountId) {
      throw new Error("Cannot remove active account — select another first");
    }
    // 校验 .pier-managed-home 标记存在才删除托管目录
    const dir = accountHomeDir(accountId);
    const markerPath = join(dir, PIER_MANAGED_HOME_MARKER);
    if (existsSync(markerPath)) {
      await rm(dir, { recursive: true, force: true });
    } else {
      console.warn(
        `[agent-accounts] managed home marker missing for ${accountId}, skipping directory removal`
      );
    }
    stateStore.mutate((s) => ({
      ...s,
      accounts: s.accounts.filter((a) => a.id !== accountId),
    }));
    delete usageCache[accountId];
    emitSnapshot();
  }

  function usageResultToAccountUsage(
    accountId: string,
    result: AccountUsageResult
  ): AccountUsage {
    return {
      accountId,
      fetchedAt: now(),
      status: result.status,
      error: result.error,
      session: result.session,
      weekly: result.weekly,
    };
  }

  async function doRefreshUsage(force = false): Promise<void> {
    const state = stateStore.get();
    if (!state.activeAccountId) {
      return;
    }
    const cached = usageCache[state.activeAccountId];
    if (!force && cached && now() - cached.fetchedAt < USAGE_MIN_REFETCH_MS) {
      return; // 防抖：5min 内不重复拉取（手动 force 绕过）
    }
    const abort = new AbortController();
    const result = await provider.fetchUsage(abort.signal);
    usageCache[state.activeAccountId] = usageResultToAccountUsage(
      state.activeAccountId,
      result
    );
    emitSnapshot();
  }

  /** 漂移处理：读真实身份 → 按 providerAccountId 匹配 → 对齐或自动接管。 */
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
        }));
      }
      await provider.syncBack(
        accountHomeDir(match.id),
        match.providerAccountId
      );
    } else {
      // 未知身份自动接管为新托管账号
      await doAdoptCurrent();
      return; // doAdoptCurrent 已 emitSnapshot
    }
    emitSnapshot();
  }

  function setupWatch(): void {
    watchDispose = provider.watchExternalAuth(() => {
      if (now() < suppressWatchUntil) {
        return;
      }
      // 入队而非直调：handleDrift 会 mutate 状态并 syncBack，与在途
      // 写操作（doSelect 的 syncBack→materialize 间隙等）交错会串号。
      // doSelect 内部的 handleDrift 调用已在队内，保持直调不变。
      enqueueMutation(async () => {
        if (now() < suppressWatchUntil) {
          return; // 排队期间物化完成的自触发事件在此二次过滤
        }
        await handleDrift();
      }).catch(() => {
        // 静默：watch 回调不应抛到外层
      });
    });
  }

  return {
    async init(): Promise<void> {
      await stateStore.init();
      // 自动接管：无托管账号但本地有真实登录凭据 → 入队接管（幂等）
      const state = stateStore.get();
      if (state.accounts.length === 0) {
        const identity = await provider.readIdentity(realCodexHome());
        if (identity) {
          await enqueueMutation(doAdoptCurrent);
        }
      }
      setupWatch();
      // 启动 usage 轮询
      usagePollTimer = setInterval(() => {
        if (!hasVisibleTarget()) {
          return; // 无窗口（macOS dock 常驻态）跳过轮询
        }
        doRefreshUsage().catch(() => {
          /* fire-and-forget */
        });
      }, USAGE_POLL_INTERVAL_MS);
      // 冷启动不等 15min：服务创建后立即非 force 拉取一次用量
      doRefreshUsage(false).catch(() => {
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

    snapshot: () => buildSnapshot(),

    adoptCurrent: () => enqueueMutation(doAdoptCurrent),
    add: () => enqueueMutation(doAdd),
    cancelLogin: () => {
      // abort 必须在队列外同步执行：cancel 的对象正是当前占着队列的
      // doAdd（它在 await provider.login）。入队会排在它后面，等于
      // 最长 5 分钟的空操作。dispose() 同理在队列外 abort。
      loginAbort?.abort();
      return enqueueMutation(() => {
        loginAbort = null;
        loginPending = null;
        emitSnapshot();
        return Promise.resolve();
      });
    },
    select: (accountId) => enqueueMutation(() => doSelect(accountId)),
    remove: (accountId) => enqueueMutation(() => doRemove(accountId)),
    refreshUsage: (force) => doRefreshUsage(force),
  };
}
