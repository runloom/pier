import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentAccountsService,
  createAgentAccountsService,
} from "@main/services/agent-accounts/service.ts";
import type { AgentAccountProvider } from "@main/services/agent-accounts/types.ts";
import type { AgentAccountsStateStore } from "@main/state/agent-accounts-state.ts";
import type {
  AgentAccount,
  AgentAccountsSnapshot,
} from "@shared/contracts/agent-accounts.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACTIVE_RE = /active/i;

interface MemoryState {
  accounts: AgentAccount[];
  activeAccountId: string | null;
  version: 1;
}

/* biome-ignore lint/suspicious/noEmptyBlockStatements: vi.fn stubs */
const noop = () => {};

function makeMemoryStateStore(): AgentAccountsStateStore {
  let state: MemoryState = {
    accounts: [],
    activeAccountId: null,
    version: 1 as const,
  };
  return {
    init: vi.fn(async () => state),
    get: vi.fn(() => state),
    mutate: vi.fn((fn: (s: MemoryState) => MemoryState) => {
      state = fn(state);
      return state;
    }),
    flush: vi.fn(async () => {
      /* persist stub */
    }),
  };
}

function makeMockProvider(): AgentAccountProvider & Record<string, unknown> {
  return {
    id: "codex",
    login: vi.fn(async () => {
      /* login stub */
    }),
    readIdentity: vi.fn(async () => ({
      email: "test@example.com",
      planType: "pro",
      providerAccountId: "prov-acc-1",
    })),
    materialize: vi.fn(async () => {
      /* materialize stub */
    }),
    syncBack: vi.fn(async () => "ok" as const),
    watchExternalAuth: vi.fn(() => noop),
    fetchUsage: vi.fn(async () => ({ status: "ok" as const })),
  };
}

/** Cast provider method to vi.fn for mock API calls. */
function asMock(fn: unknown): ReturnType<typeof vi.fn> {
  return fn as ReturnType<typeof vi.fn>;
}

describe("AgentAccountsService", () => {
  let stateStore: AgentAccountsStateStore;
  let provider: AgentAccountProvider;
  let service: AgentAccountsService;
  let broadcasts: AgentAccountsSnapshot[];
  let managedDir: string;

  beforeEach(async () => {
    managedDir = join(
      tmpdir(),
      `pier-svc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    stateStore = makeMemoryStateStore();
    provider = makeMockProvider();
    broadcasts = [];
    // init 时默认不触发自动接管（无本地 auth）；
    // 需要自动接管的测试单独配置 readIdentity
    asMock(provider.readIdentity).mockResolvedValueOnce(null);
    service = createAgentAccountsService({
      broadcast: (snap) => broadcasts.push(snap),
      managedBaseDir: managedDir,
      provider,
      stateStore,
    });
    await service.init();
  });

  afterEach(async () => {
    service.dispose();
    await rm(managedDir, { recursive: true, force: true }).catch(noop);
  });

  it("init 后无本地 auth 时 snapshot 返回空状态", () => {
    const snap = service.snapshot();
    expect(snap.accounts).toEqual([]);
    expect(snap.activeAccountId).toBeNull();
    expect(snap.loginPending).toBeNull();
    expect(snap.lastLoginError).toBeNull();
    expect(snap.ts).toBeGreaterThan(0);
  });

  it("adopt 建账号记录并设为活跃", async () => {
    await service.adoptCurrent();
    const snap = service.snapshot();
    expect(snap.accounts).toHaveLength(1);
    expect(snap.accounts[0]?.email).toBe("test@example.com");
    expect(snap.activeAccountId).toBe(snap.accounts[0]?.id);
    expect(broadcasts.length).toBeGreaterThan(0);
  });

  it("adopt 幂等——相同 providerAccountId 不重复建号", async () => {
    await service.adoptCurrent();
    const firstId = service.snapshot().accounts[0]?.id;
    await service.adoptCurrent();
    expect(service.snapshot().accounts).toHaveLength(1);
    expect(service.snapshot().accounts[0]?.id).toBe(firstId);
  });

  it("select 时序铁律：syncBack 先于 materialize", async () => {
    await service.adoptCurrent();

    asMock(provider.readIdentity).mockResolvedValue({
      email: "bob@example.com",
      planType: "plus",
      providerAccountId: "prov-acc-2",
    });
    await service.adoptCurrent();

    asMock(provider.syncBack).mockClear();
    asMock(provider.materialize).mockClear();

    const callOrder: string[] = [];
    asMock(provider.syncBack).mockImplementation(() => {
      callOrder.push("syncBack");
      return Promise.resolve("ok" as const);
    });
    asMock(provider.materialize).mockImplementation(() => {
      callOrder.push("materialize");
      return Promise.resolve();
    });

    const acc1Id = service.snapshot().accounts[0]?.id;
    await service.select(acc1Id ?? "");

    expect(callOrder).toEqual(["syncBack", "materialize"]);
    expect(service.snapshot().activeAccountId).toBe(acc1Id);
  });

  it("active 账号禁删", async () => {
    await service.adoptCurrent();
    const activeId = service.snapshot().activeAccountId ?? "";
    await expect(service.remove(activeId)).rejects.toThrow(ACTIVE_RE);
  });

  it("mutation 串行化——并发 select 顺序化执行", async () => {
    await service.adoptCurrent();
    asMock(provider.readIdentity).mockResolvedValue({
      email: "b@b.com",
      planType: "pro",
      providerAccountId: "prov-2",
    });
    await service.adoptCurrent();
    const ids = service.snapshot().accounts.map((a) => a.id);

    const p1 = service.select(ids[0] ?? "");
    const p2 = service.select(ids[1] ?? "");
    await Promise.all([p1, p2]);

    expect(service.snapshot().activeAccountId).toBe(ids[1]);
  });

  it("syncBack 身份 mismatch 归档外部身份后仍切到用户所选账号", async () => {
    await service.adoptCurrent();
    asMock(provider.readIdentity).mockResolvedValue({
      email: "bob@example.com",
      planType: "plus",
      providerAccountId: "prov-acc-2",
    });
    await service.adoptCurrent();

    asMock(provider.syncBack).mockResolvedValue("identity-mismatch");
    asMock(provider.materialize).mockClear();
    asMock(provider.readIdentity).mockResolvedValue({
      email: "external@example.com",
      providerAccountId: "prov-external",
    });

    const acc1Id = service.snapshot().accounts[0]?.id;
    await service.select(acc1Id ?? "");

    // 外部身份被归档为第三个托管账号（handleDrift 自动接管）
    expect(service.snapshot().accounts).toHaveLength(3);
    const adopted = service
      .snapshot()
      .accounts.find((a) => a.providerAccountId === "prov-external");
    expect(adopted).toBeDefined();
    // 关键：不静默中止——最终仍切到用户请求的 acc1，且物化其凭据
    expect(service.snapshot().activeAccountId).toBe(acc1Id);
    expect(provider.materialize).toHaveBeenCalledWith(
      join(managedDir, "codex", acc1Id ?? "")
    );
  });

  it("物化后 debounce 尾巴不自触发漂移处理", async () => {
    await service.adoptCurrent();
    asMock(provider.readIdentity).mockResolvedValue({
      email: "bob@example.com",
      planType: "plus",
      providerAccountId: "prov-acc-2",
    });
    await service.adoptCurrent();

    const watchCalls = asMock(provider.watchExternalAuth).mock.calls;
    expect(watchCalls).toHaveLength(1);
    const watchCb = watchCalls[0]?.[0] as () => Promise<void>;

    asMock(provider.syncBack).mockResolvedValue("ok");
    const readIdentitySpy = vi.fn();
    provider.readIdentity = readIdentitySpy;

    const acc1 = service.snapshot().accounts[0];
    await service.select(acc1?.id ?? "");

    await watchCb();

    expect(readIdentitySpy).not.toHaveBeenCalled();
  });

  it("re-auth 更新凭据到既有托管目录并清理临时目录", async () => {
    await service.adoptCurrent();
    const existingId = service.snapshot().accounts[0]?.id ?? "";
    const existingDir = join(managedDir, "codex", existingId);

    const newAuthContent = JSON.stringify({
      tokens: { id_token: "new-token" },
    });
    asMock(provider.login).mockImplementation(async (homeDir: string) => {
      await writeFile(join(homeDir, "auth.json"), newAuthContent);
    });

    await service.add("codex");

    const updatedAuth = await readFile(join(existingDir, "auth.json"), "utf-8");
    expect(updatedAuth).toBe(newAuthContent);
    expect(service.snapshot().accounts).toHaveLength(1);
    expect(service.snapshot().accounts[0]?.lastAuthenticatedAt).toBeDefined();
    const dirs = await readdir(join(managedDir, "codex"));
    expect(dirs).toEqual([existingId]);
  });

  it("登录失败清理临时目录并设置错误状态（add reject）", async () => {
    // 非 abort 的自发失败 → add() reject 且设错误态
    asMock(provider.login).mockRejectedValue(new Error("Login failed"));

    await expect(service.add("codex")).rejects.toThrow("Login failed");

    expect(service.snapshot().lastLoginError).not.toBeNull();
    let dirs: string[] = [];
    try {
      dirs = await readdir(join(managedDir, "codex"));
    } catch {
      // codex 目录可能不存在
    }
    expect(dirs).toEqual([]);
  });

  it("remove 有标记时删除托管目录", async () => {
    await service.adoptCurrent();
    const accId = service.snapshot().accounts[0]?.id ?? "";
    const dir = join(managedDir, "codex", accId);

    asMock(provider.readIdentity).mockResolvedValue({
      email: "b@b.com",
      planType: "pro",
      providerAccountId: "prov-2",
    });
    await service.adoptCurrent();

    await service.remove(accId);

    expect(existsSync(dir)).toBe(false);
    expect(service.snapshot().accounts).toHaveLength(1);
  });

  it("remove 无标记时不删目录仅移除状态", async () => {
    await service.adoptCurrent();
    const accId = service.snapshot().accounts[0]?.id ?? "";
    const dir = join(managedDir, "codex", accId);

    await rm(join(dir, ".pier-managed-home"), { force: true });

    asMock(provider.readIdentity).mockResolvedValue({
      email: "b@b.com",
      planType: "pro",
      providerAccountId: "prov-2",
    });
    await service.adoptCurrent();

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(noop);
    await service.remove(accId);

    expect(existsSync(dir)).toBe(true);
    expect(service.snapshot().accounts).toHaveLength(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("select 成功后触发 usage 刷新", async () => {
    await service.adoptCurrent();
    asMock(provider.readIdentity).mockResolvedValue({
      email: "bob@example.com",
      planType: "plus",
      providerAccountId: "prov-acc-2",
    });
    await service.adoptCurrent();
    const acc1 = service.snapshot().accounts[0];

    asMock(provider.syncBack).mockResolvedValue("ok");
    asMock(provider.fetchUsage).mockClear();

    await service.select(acc1?.id ?? "");

    expect(provider.fetchUsage).toHaveBeenCalled();
  });

  it("init 触发首拉（非 force fetchUsage）", async () => {
    await service.adoptCurrent();
    asMock(provider.fetchUsage).mockClear();

    service.dispose();
    service = createAgentAccountsService({
      broadcast: (snap) => broadcasts.push(snap),
      managedBaseDir: managedDir,
      provider,
      stateStore,
    });
    await service.init();

    expect(provider.fetchUsage).toHaveBeenCalled();
  });

  it("hasVisibleTarget=false 时轮询 tick 不调 provider.fetchUsage", async () => {
    service.dispose();

    vi.useFakeTimers();

    service = createAgentAccountsService({
      broadcast: (snap) => broadcasts.push(snap),
      hasVisibleTarget: () => false,
      managedBaseDir: managedDir,
      provider,
      stateStore,
    });
    await service.init();

    asMock(provider.fetchUsage).mockClear();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(provider.fetchUsage).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
  it("cancelLogin 在 mutation 队列外同步 abort 在途登录", async () => {
    const signalRef: { current: AbortSignal | null } = { current: null };
    const loginStarted = Promise.withResolvers<void>();
    let rejectLogin: (err: Error) => void = noop;
    asMock(provider.login).mockImplementation(
      (_homeDir: string, signal: AbortSignal) => {
        const login = Promise.withResolvers<void>();
        signalRef.current = signal;
        rejectLogin = login.reject;
        loginStarted.resolve();
        return login.promise;
      }
    );

    const addPromise = service.add("codex");
    await loginStarted.promise; // doAdd 此刻占着队列，await provider.login 中

    expect(signalRef.current?.aborted).toBe(false);

    // 不 await：cancelLogin 的队列任务排在 doAdd 之后，此刻必然未执行
    const cancelPromise = service.cancelLogin("codex");

    // 锁新行为：abort 在队列外同步生效，而非等 doAdd 结束后才轮到
    expect(signalRef.current?.aborted).toBe(true);

    rejectLogin(new Error("Login cancelled"));
    // 用户取消 → add() reject 以 AbortError 哨兵（调用方据此静默处理）
    await expect(addPromise).rejects.toMatchObject({ name: "AbortError" });
    await cancelPromise;
    expect(service.snapshot().loginPending).toBeNull();
    // 取消不设错误态
    expect(service.snapshot().lastLoginError).toBeNull();
  });

  it("watch 漂移处理走 mutation 队列——在途 mutation 结束后才执行", async () => {
    const watchCalls = asMock(provider.watchExternalAuth).mock.calls;
    expect(watchCalls).toHaveLength(1);
    const watchCb = watchCalls[0]?.[0] as () => void;

    const loginStarted = Promise.withResolvers<void>();
    let rejectLogin: (err: Error) => void = noop;
    asMock(provider.login).mockImplementation(() => {
      const login = Promise.withResolvers<void>();
      rejectLogin = login.reject;
      loginStarted.resolve();
      return login.promise;
    });

    const addPromise = service.add("codex");
    await loginStarted.promise; // 队列被 doAdd 占住

    asMock(provider.readIdentity).mockClear();
    watchCb();

    // 微任务排空后 drift 仍未执行——它在队列里排在 doAdd 之后
    await new Promise((resolve) => setImmediate(resolve));
    expect(provider.readIdentity).not.toHaveBeenCalled();

    // 放行在途 mutation（此处未 abort signal，login 自发失败 → add reject）
    rejectLogin(new Error("Login failed"));
    await expect(addPromise).rejects.toThrow("Login failed");

    // 队列排空后 drift 才执行（handleDrift + doAdoptCurrent 各读一次身份）
    await vi.waitFor(() => {
      expect(provider.readIdentity).toHaveBeenCalled();
    });
  });

  it("add 成功后不自动切换活跃账号", async () => {
    await service.adoptCurrent();
    const originalActiveId = service.snapshot().activeAccountId;
    expect(originalActiveId).not.toBeNull();

    asMock(provider.readIdentity).mockResolvedValue({
      email: "new@example.com",
      planType: "plus",
      providerAccountId: "prov-acc-new",
    });
    asMock(provider.materialize).mockClear();

    await service.add("codex");

    expect(service.snapshot().accounts).toHaveLength(2);
    expect(service.snapshot().activeAccountId).toBe(originalActiveId);
    expect(provider.materialize).not.toHaveBeenCalled();
  });

  it("外部漂移：匹配托管账号则对齐并回采，未知身份自动接管", async () => {
    await service.adoptCurrent(); // 账号 A：prov-acc-1
    asMock(provider.readIdentity).mockResolvedValue({
      email: "b@example.com",
      planType: "plus",
      providerAccountId: "prov-acc-2",
    });
    await service.adoptCurrent(); // 账号 B：prov-acc-2，活跃
    const [accA, accB] = service.snapshot().accounts;
    expect(service.snapshot().activeAccountId).toBe(accB?.id);

    const watchCb = asMock(provider.watchExternalAuth).mock
      .calls[0]?.[0] as () => void;

    // match 分支：真实 ~/.codex 身份漂到 A → activeAccountId 对齐 A 并回采
    asMock(provider.readIdentity).mockResolvedValue({
      email: "test@example.com",
      planType: "pro",
      providerAccountId: "prov-acc-1",
    });
    asMock(provider.syncBack).mockClear();
    watchCb();
    await vi.waitFor(() => {
      expect(service.snapshot().activeAccountId).toBe(accA?.id);
    });
    expect(provider.syncBack).toHaveBeenCalledWith(
      join(managedDir, "codex", accA?.id ?? ""),
      "prov-acc-1"
    );

    // unmatch 分支：未知身份 → 自动接管为新托管账号
    asMock(provider.readIdentity).mockResolvedValue({
      email: "stranger@example.com",
      providerAccountId: "prov-unknown",
    });
    watchCb();
    await vi.waitFor(() => {
      expect(service.snapshot().accounts).toHaveLength(3);
    });
    const adopted = service
      .snapshot()
      .accounts.find((a) => a.providerAccountId === "prov-unknown");
    expect(adopted).toBeDefined();
    expect(service.snapshot().activeAccountId).toBe(adopted?.id);
  });

  it("init 无账号有本地 auth → 自动接管", async () => {
    service.dispose();
    const freshStore = makeMemoryStateStore();
    const freshProvider = makeMockProvider();
    asMock(freshProvider.readIdentity).mockResolvedValue({
      email: "local@example.com",
      planType: "free",
      providerAccountId: "prov-local",
    });
    const freshBroadcasts: AgentAccountsSnapshot[] = [];
    service = createAgentAccountsService({
      broadcast: (snap) => freshBroadcasts.push(snap),
      managedBaseDir: managedDir,
      provider: freshProvider,
      stateStore: freshStore,
    });
    await service.init();

    expect(service.snapshot().accounts).toHaveLength(1);
    expect(service.snapshot().accounts[0]?.email).toBe("local@example.com");
    expect(service.snapshot().activeAccountId).toBe(
      service.snapshot().accounts[0]?.id
    );
  });

  it("init 已有账号不重复接管", async () => {
    // 先走默认 init（readIdentity 返回 null → 不接管）
    // 手动 adopt 建号
    await service.adoptCurrent();
    const accountsBefore = service.snapshot().accounts.length;

    // 重建 service
    service.dispose();
    service = createAgentAccountsService({
      broadcast: (snap) => broadcasts.push(snap),
      managedBaseDir: managedDir,
      provider,
      stateStore,
    });
    await service.init();

    expect(service.snapshot().accounts).toHaveLength(accountsBefore);
  });

  it("init 无本地 auth 不动作", async () => {
    service.dispose();
    const freshStore = makeMemoryStateStore();
    const freshProvider = makeMockProvider();
    asMock(freshProvider.readIdentity).mockResolvedValue(null);
    service = createAgentAccountsService({
      broadcast: noop as (snap: AgentAccountsSnapshot) => void,
      managedBaseDir: managedDir,
      provider: freshProvider,
      stateStore: freshStore,
    });
    await service.init();

    expect(service.snapshot().accounts).toEqual([]);
  });

  it("doAdd 登录失败设置 lastLoginError 且 add reject", async () => {
    asMock(provider.login).mockRejectedValue(new Error("Network error"));

    await expect(service.add("codex")).rejects.toThrow("Network error");

    const snap = service.snapshot();
    expect(snap.lastLoginError).not.toBeNull();
    expect(snap.lastLoginError?.message).toBe("Network error");
    expect(snap.loginPending).toBeNull();
  });

  it("doAdd AbortError（取消）不设错误状态，add reject 为 AbortError", async () => {
    const abortErr = new Error("Aborted");
    abortErr.name = "AbortError";
    asMock(provider.login).mockRejectedValue(abortErr);

    await expect(service.add("codex")).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(service.snapshot().lastLoginError).toBeNull();
    expect(service.snapshot().loginPending).toBeNull();
  });

  it("doAdd 超时设置超时错误信息", async () => {
    vi.useFakeTimers();
    // 模拟超时：login 在 abort 时 reject；用 loginStarted 同步等到 setTimeout 已注册
    const loginStarted = Promise.withResolvers<void>();
    asMock(provider.login).mockImplementation(
      (_dir: string, signal: AbortSignal) => {
        const { promise, reject } = Promise.withResolvers<void>();
        signal.addEventListener("abort", () =>
          reject(new Error("Login timeout"))
        );
        loginStarted.resolve();
        return promise;
      }
    );

    const addPromise = service.add("codex");
    // 等 login 被调用（ensureManagedDir I/O 完成 + setTimeout 已注册）
    await loginStarted.promise;
    // 推进到超过 LOGIN_TIMEOUT_MS（5min）
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    // 超时 → add reject（区别于用户取消：超时会设错误态并 reject 非 AbortError）
    await expect(addPromise).rejects.toThrow("Login timed out after 5 minutes");

    const snap = service.snapshot();
    expect(snap.lastLoginError).not.toBeNull();
    expect(snap.lastLoginError?.message).toBe(
      "Login timed out after 5 minutes"
    );
    vi.useRealTimers();
  });

  it("#2 re-auth 当前活跃账号时把新凭据也物化到真实 ~/.codex", async () => {
    await service.adoptCurrent(); // A 活跃，prov-acc-1
    const activeId = service.snapshot().activeAccountId ?? "";
    asMock(provider.materialize).mockClear();
    asMock(provider.login).mockImplementation(async (homeDir: string) => {
      await writeFile(join(homeDir, "auth.json"), '{"tokens":{}}');
    });
    // readIdentity 匹配活跃账号 prov-acc-1 → re-auth 分支

    await service.add("codex");

    // 活跃账号 re-auth：新凭据须物化到真实 home，否则终端仍用旧凭据
    expect(provider.materialize).toHaveBeenCalledWith(
      join(managedDir, "codex", activeId)
    );
  });

  it("#6 用量拉取期间活跃账号改变 → 结果不错记到原账号", async () => {
    await service.adoptCurrent(); // A
    asMock(provider.readIdentity).mockResolvedValue({
      email: "b@b.com",
      providerAccountId: "prov-2",
    });
    await service.adoptCurrent(); // B 活跃
    const [accA, accB] = service.snapshot().accounts;

    const gate = Promise.withResolvers<void>();
    asMock(provider.fetchUsage).mockReturnValue(
      gate.promise.then(() => ({ status: "ok" as const }))
    );

    const refreshP = service.refreshUsage(true); // capturedId = B
    // 模拟拉取期间 select 完成，活跃账号切到 A
    stateStore.mutate((s) => ({ ...s, activeAccountId: accA?.id ?? null }));
    gate.resolve();
    await refreshP;

    // 读到不确定凭据的结果不得错记到 B 名下
    expect(service.snapshot().usage[accB?.id ?? ""]).toBeUndefined();
  });

  it("#11 用量拉取前 await ensureUsageEnv（补齐 PATH）", async () => {
    service.dispose();
    const order: string[] = [];
    const ensureUsageEnv = vi.fn(() => {
      order.push("ensureEnv");
      return Promise.resolve();
    });
    const freshStore = makeMemoryStateStore();
    const freshProvider = makeMockProvider();
    asMock(freshProvider.readIdentity).mockResolvedValueOnce(null);
    asMock(freshProvider.fetchUsage).mockImplementation(() => {
      order.push("fetch");
      return Promise.resolve({ status: "ok" as const });
    });
    service = createAgentAccountsService({
      broadcast: noop as (snap: AgentAccountsSnapshot) => void,
      ensureUsageEnv,
      managedBaseDir: managedDir,
      provider: freshProvider,
      stateStore: freshStore,
    });
    await service.init();
    // 造一个活跃账号让 doRefreshUsage 真正拉取
    await service.adoptCurrent();
    order.length = 0;
    await service.refreshUsage(true);

    expect(order).toEqual(["ensureEnv", "fetch"]);
  });

  it("#7 init 已有账号时对账外部身份漂移并 realign", async () => {
    // 预置：A(prov-acc-1)、B(prov-acc-2)，活跃 B
    await service.adoptCurrent(); // A
    asMock(provider.readIdentity).mockResolvedValue({
      email: "b@b.com",
      providerAccountId: "prov-acc-2",
    });
    await service.adoptCurrent(); // B 活跃
    const accA = service.snapshot().accounts[0];
    expect(service.snapshot().activeAccountId).not.toBe(accA?.id);

    // 模拟 app 关闭期间外部 `codex login` 切回 A
    asMock(provider.readIdentity).mockResolvedValue({
      email: "test@example.com",
      providerAccountId: "prov-acc-1",
    });
    // 复用同一 store 重建 service（活跃仍持久化为 B）
    service.dispose();
    service = createAgentAccountsService({
      broadcast: (snap) => broadcasts.push(snap),
      managedBaseDir: managedDir,
      provider,
      stateStore,
    });
    await service.init();

    // init 对账后活跃 realign 到真实身份 A（非空列表也对账，修复前只有空列表才对账）
    expect(service.snapshot().activeAccountId).toBe(accA?.id);
  });

  it("doAdd 重试清除之前的 lastLoginError", async () => {
    // 先失败（add reject）
    asMock(provider.login).mockRejectedValue(new Error("First failure"));
    await expect(service.add("codex")).rejects.toThrow("First failure");
    expect(service.snapshot().lastLoginError).not.toBeNull();
    const accountsBefore = service.snapshot().accounts.length;

    // 重试成功
    asMock(provider.login).mockResolvedValue(undefined);
    asMock(provider.readIdentity).mockResolvedValue({
      email: "retry@example.com",
      planType: "pro",
      providerAccountId: "prov-retry",
    });
    await service.add("codex");

    expect(service.snapshot().lastLoginError).toBeNull();
    expect(service.snapshot().accounts).toHaveLength(accountsBefore + 1);
  });
});
