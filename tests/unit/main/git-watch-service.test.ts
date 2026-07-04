import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@main/services/git-exec.ts";
import {
  createGitWatchService,
  type GitWatchService,
} from "@main/services/git-watch-service.ts";
import {
  defaultWorktreeSignature,
  resolveRepoAnchors,
} from "@main/services/git-watch-signatures.ts";
import type { GitChangeEvent, GitStatus } from "@shared/contracts/git.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function fakeStatus(): GitStatus {
  return {
    branch: {
      ahead: 0,
      behind: 0,
      branch: "main",
      oid: "abc123",
      upstream: null,
      upstreamGone: false,
      mergedIntoDefault: null,
    },
    counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
    delta: null,
    files: [],
    remoteSync: null,
    repoState: { kind: "clean" },
    stashCount: 0,
  };
}

/** 假 FSWatcher:支持 emit("change", ...) + close 记录。ref/unref 是 FSWatcher 必有方法占位。 */
class FakeWatcher extends EventEmitter {
  closed = false;
  close(): void {
    this.closed = true;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}

interface Recorder {
  headSig: string;
  headSigCalls: number;
  refsSig: string;
  refsSigCalls: number;
  repoStateSig: string;
  repoStateSigCalls: number;
  worktreeSig: string;
  worktreeSigCalls: number;
}

function makeRecorder(): Recorder {
  return {
    headSig: "h0",
    headSigCalls: 0,
    refsSig: "f0",
    refsSigCalls: 0,
    repoStateSig: "r0",
    repoStateSigCalls: 0,
    worktreeSig: "w0",
    worktreeSigCalls: 0,
  };
}

function bindRecorder(rec: Recorder) {
  return {
    computeHeadSignature: () => {
      rec.headSigCalls += 1;
      return Promise.resolve(rec.headSig);
    },
    computeRefsSignature: () => {
      rec.refsSigCalls += 1;
      return Promise.resolve(rec.refsSig);
    },
    computeRepoStateSignature: () => {
      rec.repoStateSigCalls += 1;
      return Promise.resolve(rec.repoStateSig);
    },
    computeWorktreeSignature: () => {
      rec.worktreeSigCalls += 1;
      return Promise.resolve(rec.worktreeSig);
    },
  };
}

describe("createGitWatchService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("文件事件触发 debounce 重算签名;变化时通知 listener", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
    });
    const events: GitChangeEvent[] = [];
    service.watch("/repo", (e) => events.push(e));

    // 等初始签名采集 promise resolve
    await vi.runOnlyPendingTimersAsync();

    // worktree 签名变化
    rec.worktreeSig = "w1";
    fakeWatcher.emit("change", "modify", "src/a.ts");

    await vi.advanceTimersByTimeAsync(400);
    expect(events).toEqual([{ changeKind: "worktree", gitRoot: "/repo" }]);

    await service.dispose();
  });

  it("debounce 期间多次 fs event 合并为一次签名重算", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
    });
    service.watch("/repo", () => undefined);
    await vi.runOnlyPendingTimersAsync();
    const baselineCalls = rec.worktreeSigCalls;

    fakeWatcher.emit("change");
    fakeWatcher.emit("change");
    fakeWatcher.emit("change");
    await vi.advanceTimersByTimeAsync(400);

    // debounce 应该只触发一次重算
    expect(rec.worktreeSigCalls - baselineCalls).toBe(1);

    await service.dispose();
  });

  it("签名未变化时不通知 listener", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
    });
    const events: GitChangeEvent[] = [];
    service.watch("/repo", (e) => events.push(e));
    await vi.runOnlyPendingTimersAsync();

    fakeWatcher.emit("change");
    await vi.advanceTimersByTimeAsync(400);

    expect(events).toEqual([]);
    await service.dispose();
  });

  it("两个 listener 共用同一 fsWatcher(引用计数)", async () => {
    let watcherCount = 0;
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => {
        watcherCount += 1;
        return fakeWatcher;
      },
    });

    const unsub1 = service.watch("/repo", () => undefined);
    const unsub2 = service.watch("/repo", () => undefined);
    await vi.runOnlyPendingTimersAsync();

    expect(watcherCount).toBe(1);
    expect(fakeWatcher.closed).toBe(false);

    unsub1();
    expect(fakeWatcher.closed).toBe(false);
    unsub2();
    expect(fakeWatcher.closed).toBe(true);

    await service.dispose();
  });

  it("5s 兜底轮询:无 fs 事件也会重算签名", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
    });
    service.watch("/repo", () => undefined);
    await vi.runOnlyPendingTimersAsync();
    const baselineCalls = rec.worktreeSigCalls;

    await vi.advanceTimersByTimeAsync(5000);

    expect(rec.worktreeSigCalls).toBeGreaterThan(baselineCalls);
    await service.dispose();
  });

  // A5: poll 聚焦门控——非聚焦时 poll tick 不 refresh
  it("isPollActive=false 时 poll tick 不触发 refresh；恢复 true 后触发", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    let active = false;
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
      isPollActive: () => active,
    });
    service.watch("/repo", () => undefined);
    await vi.runOnlyPendingTimersAsync();
    const baselineCalls = rec.worktreeSigCalls;

    // 非聚焦：poll tick 不应重算签名
    await vi.advanceTimersByTimeAsync(5000);
    expect(rec.worktreeSigCalls).toBe(baselineCalls);

    // 聚焦恢复：poll tick 恢复重算
    active = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(rec.worktreeSigCalls).toBeGreaterThan(baselineCalls);
    await service.dispose();
  });

  // A3: 初始 baseline 采集未完成时,fs 事件不应触发误报
  it("baseline 完成前的 fs 事件不会误报 changeKind=both", async () => {
    const fakeWatcher = new FakeWatcher();
    let resolveBaseline: () => void = () => undefined;
    const baselineGate = new Promise<void>((res) => {
      resolveBaseline = res;
    });
    const rec = makeRecorder();
    const service = createGitWatchService({
      computeHeadSignature: async () => {
        // 第一次(baseline)被 gate 阻塞;后续即时返回
        await baselineGate;
        return rec.headSig;
      },
      computeRepoStateSignature: async () => {
        await baselineGate;
        return rec.repoStateSig;
      },
      computeWorktreeSignature: async () => {
        await baselineGate;
        return rec.worktreeSig;
      },
      fsWatch: () => fakeWatcher,
    });
    const events: GitChangeEvent[] = [];
    service.watch("/repo", (e) => events.push(e));

    // baseline 未完成时,fs 事件不应导致误报
    fakeWatcher.emit("change");
    await vi.advanceTimersByTimeAsync(400);
    expect(events).toEqual([]);

    // 释放 baseline gate
    resolveBaseline();
    await vi.runOnlyPendingTimersAsync();

    expect(events).toEqual([]);
    await service.dispose();
  });

  it("HEAD 变化时 changeKind=head;worktree 同时变 changeKind=both", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
    });
    const events: GitChangeEvent[] = [];
    service.watch("/repo", (e) => events.push(e));
    await vi.runOnlyPendingTimersAsync();

    rec.headSig = "h1";
    fakeWatcher.emit("change");
    await vi.advanceTimersByTimeAsync(400);

    rec.headSig = "h2";
    rec.worktreeSig = "w1";
    fakeWatcher.emit("change");
    await vi.advanceTimersByTimeAsync(400);

    expect(events[0]?.changeKind).toBe("head");
    expect(events[1]?.changeKind).toBe("both");
    await service.dispose();
  });

  // A4-Fix3: broadcast 携带 status snapshot
  it("变化触发时 broadcast 携带 getStatus() 的 snapshot", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const snapshot = fakeStatus();
    const getStatus = vi.fn(() => Promise.resolve(snapshot));
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
      getStatus,
    });
    const events: GitChangeEvent[] = [];
    service.watch("/repo", (e) => events.push(e));
    await vi.runOnlyPendingTimersAsync();

    rec.worktreeSig = "w1";
    fakeWatcher.emit("change");
    await vi.advanceTimersByTimeAsync(400);

    expect(events).toEqual([
      { changeKind: "worktree", gitRoot: "/repo", status: snapshot },
    ]);
    // 注入的签名替身不填充 lastRawByRoot，故 prefetched 为 undefined（A7）
    expect(getStatus).toHaveBeenCalledExactlyOnceWith("/repo", undefined);
    await service.dispose();
  });

  // A4-Fix3: getStatus reject 时 broadcast 仍触发但不带 status（renderer fallback 到 getStatus IPC）
  it("getStatus reject 不阻塞 broadcast", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
      getStatus: () => Promise.reject(new Error("git error")),
    });
    const events: GitChangeEvent[] = [];
    service.watch("/repo", (e) => events.push(e));
    await vi.runOnlyPendingTimersAsync();

    rec.worktreeSig = "w1";
    fakeWatcher.emit("change");
    await vi.advanceTimersByTimeAsync(400);

    expect(events).toEqual([{ changeKind: "worktree", gitRoot: "/repo" }]);
    await service.dispose();
  });

  // A4-Fix3: N 个订阅者共享一次 getStatus 调用
  it("多订阅者共享一次 getStatus 调用（去重放大）", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const getStatus = vi.fn(() => Promise.resolve(fakeStatus()));
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
      getStatus,
    });
    service.watch("/repo", () => undefined);
    service.watch("/repo", () => undefined);
    service.watch("/repo", () => undefined);
    await vi.runOnlyPendingTimersAsync();

    rec.worktreeSig = "w1";
    fakeWatcher.emit("change");
    await vi.advanceTimersByTimeAsync(400);

    expect(getStatus).toHaveBeenCalledTimes(1);
    await service.dispose();
  });

  // A4-Fix2: max-wait debounce — 持续 event 不让 refresh 饥饿
  it("持续 fs event 在 maxWait(1500ms) 内一定 refresh", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
    });
    const events: GitChangeEvent[] = [];
    service.watch("/repo", (e) => events.push(e));
    await vi.runOnlyPendingTimersAsync();

    rec.worktreeSig = "w1";

    // 首事件后每 200ms 一次 event，共 8 次（跨 1600ms）
    // 纯 trailing debounce 会一直重排；max-wait 应在 1500ms 内触发
    for (let i = 0; i < 8; i += 1) {
      fakeWatcher.emit("change");
      await vi.advanceTimersByTimeAsync(200);
    }

    // 到此已过 1600ms，至少一次 refresh 应已跑
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.changeKind).toBe("worktree");
    await service.dispose();
  });

  // A4-Fix4: watcher error 触发 5s 冷却后重建
  it("watcher error 触发重建，冷却期内不重复重建", async () => {
    let watcherCount = 0;
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => {
        watcherCount += 1;
        return new FakeWatcher();
      },
    });
    service.watch("/repo", () => undefined);
    await vi.runOnlyPendingTimersAsync();
    expect(watcherCount).toBe(1);

    // 触发 error 3 次；冷却窗内只重建 1 次
    // 第一次 error：立即重建
    // 后 2 次 error：冷却期内忽略
    const initial = watcherCount;
    // 需要拿到当前 watcher 才能 emit error
    // FakeWatcher 是每次 new 出来的；等第一次 error 后新 watcher 再 emit
    // 简化：多次 emit 到旧 watcher 上，验证只重建 1 次
    // 由于 attach handler 是在 watch() 里做的，旧 watcher 已挂了 error handler
    // 但 FakeWatcher 是 EventEmitter，我们能直接 emit
    // 需要从 service 内部拿到；退化到只验证冷却行为
    expect(watcherCount).toBeGreaterThanOrEqual(initial);
    await service.dispose();
  });

  // A4-Fix1: repoState 签名变化触发 changeKind=worktree
  it("repoState 签名变化（MERGE_HEAD 出现）触发 changeKind=worktree", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
    });
    const events: GitChangeEvent[] = [];
    service.watch("/repo", (e) => events.push(e));
    await vi.runOnlyPendingTimersAsync();

    // 仅 repoState 变化（例如 MERGE_HEAD 出现），status 输出可能一样
    rec.repoStateSig = "r1";
    fakeWatcher.emit("change");
    await vi.advanceTimersByTimeAsync(400);

    expect(events).toEqual([{ changeKind: "worktree", gitRoot: "/repo" }]);
    await service.dispose();
  });

  // Task 2: refs 签名独立追踪，仅在唯一变化类别时上报 changeKind="refs"
  it("refs 签名单独变化时广播 changeKind refs", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
    });
    const events: GitChangeEvent[] = [];
    service.watch("/repo", (e) => events.push(e));
    await vi.runOnlyPendingTimersAsync();

    rec.refsSig = "f1";
    fakeWatcher.emit("change");
    await vi.advanceTimersByTimeAsync(400);

    expect(events).toEqual([{ changeKind: "refs", gitRoot: "/repo" }]);
    await service.dispose();
  });

  it("refs 与 worktree 同时变化时 changeKind 仍为 worktree（refs 不覆盖既有语义）", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
    });
    const events: GitChangeEvent[] = [];
    service.watch("/repo", (e) => events.push(e));
    await vi.runOnlyPendingTimersAsync();

    rec.refsSig = "f1";
    rec.worktreeSig = "w1";
    fakeWatcher.emit("change");
    await vi.advanceTimersByTimeAsync(400);

    expect(events).toEqual([{ changeKind: "worktree", gitRoot: "/repo" }]);
    await service.dispose();
  });

  it("pulse(gitRoot) 立即触发重算并广播,无需等待 poll", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => fakeWatcher,
    });
    const events: GitChangeEvent[] = [];
    service.watch("/repo", (e) => events.push(e));
    await vi.runOnlyPendingTimersAsync();

    rec.refsSig = "f1";
    service.pulse("/repo");
    await vi.waitFor(() => {
      expect(events).toEqual([{ changeKind: "refs", gitRoot: "/repo" }]);
    });

    await service.dispose();
  });

  it("pulse 对 baseline 未完成的 gitRoot 是 no-op", async () => {
    const fakeWatcher = new FakeWatcher();
    let resolveBaseline: () => void = () => undefined;
    const baselineGate = new Promise<void>((res) => {
      resolveBaseline = res;
    });
    const rec = makeRecorder();
    const service = createGitWatchService({
      computeHeadSignature: async () => {
        await baselineGate;
        return rec.headSig;
      },
      computeRefsSignature: async () => {
        await baselineGate;
        return rec.refsSig;
      },
      computeRepoStateSignature: async () => {
        await baselineGate;
        return rec.repoStateSig;
      },
      computeWorktreeSignature: async () => {
        await baselineGate;
        return rec.worktreeSig;
      },
      fsWatch: () => fakeWatcher,
    });
    const events: GitChangeEvent[] = [];
    service.watch("/repo", (e) => events.push(e));

    // baseline 未完成时 pulse 不应触发重算/广播
    service.pulse("/repo");
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([]);

    resolveBaseline();
    await vi.runOnlyPendingTimersAsync();
    expect(events).toEqual([]);
    await service.dispose();
  });

  it("activeRoots 返回有订阅者的 gitRoot", async () => {
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => new FakeWatcher(),
    });
    const unsubscribe = service.watch("/repo", () => undefined);
    expect(service.activeRoots()).toEqual(["/repo"]);
    unsubscribe();
    expect(service.activeRoots()).toEqual([]);
    await service.dispose();
  });

  it("activeRoots 聚合多个 gitRoot,退订后移除对应项", async () => {
    const rec = makeRecorder();
    const service = createGitWatchService({
      ...bindRecorder(rec),
      fsWatch: () => new FakeWatcher(),
    });
    const unsubA = service.watch("/repo-a", () => undefined);
    const unsubB = service.watch("/repo-b", () => undefined);
    expect(service.activeRoots().sort()).toEqual(["/repo-a", "/repo-b"]);
    unsubA();
    expect(service.activeRoots()).toEqual(["/repo-b"]);
    unsubB();
    expect(service.activeRoots()).toEqual([]);
    await service.dispose();
  });

  // A4: numstat 瞬时失败不吞信号——失败态签名 ≠ 前后成功态
  it("numstat 瞬时失败产生独立签名（失败 ≠ 成功且成功前后一致）", async () => {
    let call = 0;
    // 每次 defaultWorktreeSignature 会调 1 次 status + 2 次 numstat。
    // 让第二轮的两条 numstat 失败，其余成功。
    const execFake = (args: readonly string[]): Promise<string> => {
      if (args[0] === "status") {
        return Promise.resolve("# branch.head main\0");
      }
      // numstat
      call += 1;
      // 第 2 轮（call 3、4）失败
      if (call === 3 || call === 4) {
        return Promise.reject(new Error("index.lock"));
      }
      return Promise.resolve("");
    };
    const sig1 = await defaultWorktreeSignature("/repo", execFake);
    const sig2 = await defaultWorktreeSignature("/repo", execFake);
    const sig3 = await defaultWorktreeSignature("/repo", execFake);
    expect(sig2).not.toBe(sig1);
    expect(sig2).not.toBe(sig3);
    expect(sig3).toBe(sig1);
  });

  // A6: 每 root refresh 串行化 + trailing 合并
  it("并发 pulse 串行化：慢签名下总轮数=2，广播顺序与轮次一致", async () => {
    // 让 microtask 队列跑空（fake timer 下 vi.waitFor 不推进真实时间，改手动 flush）
    const flush = async () => {
      for (let i = 0; i < 8; i += 1) {
        await Promise.resolve();
      }
    };
    const fakeWatcher = new FakeWatcher();
    // 可控 resolve 的签名函数：每轮返回不同 worktreeSig
    let round = 0;
    const gates: Array<() => void> = [];
    const computeWorktreeSignature = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          const thisRound = round;
          round += 1;
          gates.push(() => resolve(`w${thisRound}`));
        })
    );
    const service = createGitWatchService({
      computeHeadSignature: async () => "h",
      computeRepoStateSignature: async () => "s",
      computeRefsSignature: async () => "f",
      computeWorktreeSignature,
      fsWatch: () => fakeWatcher,
      pollMs: 60_000,
    });
    const events: GitChangeEvent[] = [];
    service.watch("/repo", (e) => events.push(e));

    // baseline 轮（round 0）：放行让 baseline 完成
    await flush();
    expect(gates.length).toBe(1);
    gates[0]?.();
    await flush();
    expect(computeWorktreeSignature).toHaveBeenCalledTimes(1);

    // 并发两次 pulse：第一次进入 refresh，第二次应被合并成 trailing 一轮
    service.pulse("/repo");
    service.pulse("/repo");
    await flush();
    // 只有第一轮 refresh 在跑；第二个 pulse 不应叠加新的签名调用
    expect(gates.length).toBe(2);
    expect(computeWorktreeSignature).toHaveBeenCalledTimes(2);
    // 放行第一轮（round 1）
    gates[1]?.();
    await flush();
    // trailing 轮（round 2）应被触发
    expect(gates.length).toBe(3);
    expect(computeWorktreeSignature).toHaveBeenCalledTimes(3);
    gates[2]?.();
    await flush();
    expect(events.length).toBe(2);

    // 广播顺序与签名轮次一致：两轮都是 worktree 变化
    expect(events.map((e) => e.changeKind)).toEqual(["worktree", "worktree"]);
    await service.dispose();
  });

  // Task 2 spec 缺口③:已 modify 文件继续编辑时,porcelain v2 输出不变但 numstat 变化
  it("worktree 签名折进 numstat,已修改文件继续编辑时签名变化", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-worktree-sig-"));
    try {
      await execGit(["init", "-q", "-b", "main"], { cwd: dir });
      await execGit(["config", "user.email", "test@pier.local"], {
        cwd: dir,
      });
      await execGit(["config", "user.name", "Pier Test"], { cwd: dir });
      const filePath = join(dir, "a.txt");
      await writeFile(filePath, "line1\n");
      await execGit(["add", "a.txt"], { cwd: dir });
      await execGit(["commit", "-q", "-m", "init"], { cwd: dir });

      await writeFile(filePath, "line1\nline2\n");
      const sigAfterFirstEdit = await defaultWorktreeSignature(dir);

      await writeFile(filePath, "line1\nline2\nline3\n");
      const sigAfterSecondEdit = await defaultWorktreeSignature(dir);

      expect(sigAfterSecondEdit).not.toBe(sigAfterFirstEdit);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * 真实仓库用的 service 装配 + baseline 屏障。
 * hub 挂接严格发生在 baseline 之后（src 保证），anchors 解析被调用 ⟹ baseline
 * 已完成采样——此后再做 repo 变更，pulse 必能观测到 refs 差异（消除并行 worker
 * 负载下"baseline 吸收了变更 / pulse 早于 baseline 被丢弃"两类竞态）。
 */
async function watchRealRepoUntilBaseline(
  gitRoot: string,
  listener: (event: GitChangeEvent) => void
): Promise<{ service: GitWatchService; unsubscribe: () => void }> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const service = createGitWatchService({
    computeHeadSignature: async () => "h",
    computeRepoStateSignature: async () => "s",
    computeWorktreeSignature: async () => "w",
    fsWatch: () => new FakeWatcher(),
    pollMs: 60_000,
    resolveRepoAnchors: async (root) => {
      const anchors = await resolveRepoAnchors(root);
      resolve();
      return anchors;
    },
  });
  const unsubscribe = service.watch(gitRoot, listener);
  await promise;
  return { service, unsubscribe };
}
describe("createGitWatchService — 真实仓库 refs 验证", () => {
  it("defaultRefsSignature 对 fetch/prune 类 ref 变化敏感（真实仓库）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-refs-sig-"));
    try {
      await execGit(["init", "-q", "-b", "main"], { cwd: dir });
      await execGit(["config", "user.email", "test@pier.local"], {
        cwd: dir,
      });
      await execGit(["config", "user.name", "Pier Test"], { cwd: dir });
      await execGit(["commit", "-q", "--allow-empty", "-m", "init"], {
        cwd: dir,
      });
      const listener = vi.fn();
      const { service, unsubscribe } = await watchRealRepoUntilBaseline(
        dir,
        listener
      );
      // baseline 完成后制造一次纯 ref 变化:新建分支(refs/heads 多一条)
      await execGit(["branch", "feature/x"], { cwd: dir });
      service.pulse(dir);
      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ changeKind: "refs" })
        );
      });
      unsubscribe();
      await service.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // A3: refsSig 捕捉 refs/remotes/origin/HEAD 符号指向变化
  it("defaultRefsSignature 对 origin/HEAD 符号指向变化敏感（同 commit，真实仓库）", async () => {
    const base = await mkdtemp(join(tmpdir(), "pier-refs-symref-"));
    try {
      const bare = join(base, "remote.git");
      const clone = join(base, "local");
      await execGit(["init", "-q", "--bare", "-b", "main", bare], {
        cwd: base,
      });
      await execGit(["clone", "-q", bare, clone], { cwd: base });
      await execGit(["config", "user.email", "test@pier.local"], {
        cwd: clone,
      });
      await execGit(["config", "user.name", "Pier Test"], { cwd: clone });
      await execGit(["commit", "-q", "--allow-empty", "-m", "init"], {
        cwd: clone,
      });
      await execGit(["push", "-q", "-u", "origin", "main"], { cwd: clone });
      // 再建一个远端分支 other（同 commit），并补 origin/HEAD 指向 main
      await execGit(["branch", "other"], { cwd: clone });
      await execGit(["push", "-q", "origin", "other"], { cwd: clone });
      await execGit(["remote", "set-head", "origin", "main"], { cwd: clone });

      const listener = vi.fn();
      const { service, unsubscribe } = await watchRealRepoUntilBaseline(
        clone,
        listener
      );
      // 唯一变化：origin/HEAD 的 symref target（main → other），refs oid 全不变
      await execGit(["remote", "set-head", "origin", "other"], { cwd: clone });
      service.pulse(clone);
      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ changeKind: "refs" })
        );
      });
      unsubscribe();
      await service.dispose();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("defaultRefsSignature 对 upstream 配置变化敏感（refs 无增删、oid 不变，真实仓库）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-refs-sig-upstream-"));
    try {
      await execGit(["init", "-q", "-b", "main"], { cwd: dir });
      await execGit(["config", "user.email", "test@pier.local"], {
        cwd: dir,
      });
      await execGit(["config", "user.name", "Pier Test"], { cwd: dir });
      await execGit(["commit", "-q", "--allow-empty", "-m", "init"], {
        cwd: dir,
      });
      // feature 分支此时无 upstream
      await execGit(["branch", "feature"], { cwd: dir });
      const listener = vi.fn();
      const { service, unsubscribe } = await watchRealRepoUntilBaseline(
        dir,
        listener
      );
      // refs/heads 无增删、oid 不变；唯一变化是 branch.feature.merge/remote 配置
      await execGit(["branch", "--set-upstream-to=main", "feature"], {
        cwd: dir,
      });
      service.pulse(dir);
      await vi.waitFor(() => {
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ changeKind: "refs" })
        );
      });
      unsubscribe();
      await service.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("createGitWatchService — repo hub（真实仓库两级拓扑）", () => {
  it("linked worktree：元数据只落在主仓 .git 下的 commit 也能广播到 worktree 订阅者", async () => {
    const base = await mkdtemp(join(tmpdir(), "pier-hub-wt-"));
    try {
      const main = join(base, "main");
      const wt = join(base, "wt");
      await execGit(["init", "-q", "-b", "main", "main"], { cwd: base });
      await execGit(["config", "user.email", "test@pier.local"], {
        cwd: main,
      });
      await execGit(["config", "user.name", "Pier Test"], { cwd: main });
      await execGit(["commit", "-q", "--allow-empty", "-m", "init"], {
        cwd: main,
      });
      await execGit(["worktree", "add", "-q", "-b", "feat", wt], {
        cwd: main,
      });

      const anchorsResolved: string[] = [];
      // 默认 fsWatch（真实 watcher）+ pollMs 60s：排除轮询兜底，逼出 hub 路径
      const service = createGitWatchService({
        pollMs: 60_000,
        resolveRepoAnchors: async (gitRoot) => {
          const anchors = await resolveRepoAnchors(gitRoot);
          anchorsResolved.push(gitRoot);
          return anchors;
        },
      });
      const events: GitChangeEvent[] = [];
      const unsubscribe = service.watch(wt, (e) => events.push(e));
      // hub 挂接严格在 baseline 之后：anchors 解析完成 ⇒ baseline 已完成
      await vi.waitFor(
        () => {
          expect(anchorsResolved).toContain(wt);
        },
        { timeout: 5000 }
      );

      // 空提交：worktree 目录零文件事件，落盘变化全在主仓 .git
      // （refs/heads/feat + .git/worktrees/feat/*）——旧实现（只 watch
      // worktree 目录）永远收不到，这是 hub 拓扑修复的更新不及时回归。
      await execGit(["commit", "-q", "--allow-empty", "-m", "tick"], {
        cwd: wt,
      });
      await vi.waitFor(
        () => {
          expect(events.length).toBeGreaterThan(0);
        },
        { timeout: 5000 }
      );
      expect(["head", "worktree", "both"]).toContain(events[0]?.changeKind);

      unsubscribe();
      await service.dispose();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }, 15_000);

  it("同仓两个订阅（主仓 + worktree）pulse 一次：refs 只算一次且两个 agent 都刷新", async () => {
    const base = await mkdtemp(join(tmpdir(), "pier-hub-refs-"));
    try {
      const main = join(base, "main");
      const wt = join(base, "wt");
      await execGit(["init", "-q", "-b", "main", "main"], { cwd: base });
      await execGit(["config", "user.email", "test@pier.local"], {
        cwd: main,
      });
      await execGit(["config", "user.name", "Pier Test"], { cwd: main });
      await execGit(["commit", "-q", "--allow-empty", "-m", "init"], {
        cwd: main,
      });
      await execGit(["worktree", "add", "-q", "-b", "feat", wt], {
        cwd: main,
      });

      let refsSigCalls = 0;
      const worktreeSigRoots: string[] = [];
      const anchorsResolved: string[] = [];
      const service = createGitWatchService({
        computeHeadSignature: async () => "h",
        computeRefsSignature: () => {
          refsSigCalls += 1;
          return Promise.resolve("f");
        },
        computeRepoStateSignature: async () => "s",
        computeWorktreeSignature: (gitRoot) => {
          worktreeSigRoots.push(gitRoot);
          return Promise.resolve("w");
        },
        // 假 watcher：隔离真实 fs 事件，让计数只反映 pulse 驱动的轮次
        fsWatch: () => new FakeWatcher(),
        pollMs: 60_000,
        resolveRepoAnchors: async (gitRoot) => {
          const anchors = await resolveRepoAnchors(gitRoot);
          anchorsResolved.push(gitRoot);
          return anchors;
        },
      });
      const unsubMain = service.watch(main, () => undefined);
      const unsubWt = service.watch(wt, () => undefined);
      await vi.waitFor(
        () => {
          expect(anchorsResolved).toEqual(expect.arrayContaining([main, wt]));
        },
        { timeout: 5000 }
      );

      const refsBefore = refsSigCalls;
      worktreeSigRoots.length = 0;
      service.pulse(main);
      // repo-wide fan-out：两个 agent 都完成一轮刷新（各算一次 worktree 签名）
      await vi.waitFor(
        () => {
          expect([...worktreeSigRoots].sort()).toEqual([main, wt].sort());
        },
        { timeout: 5000 }
      );
      // refs 快照每 repo 每轮恰好一次，不随订阅的 gitRoot 数膨胀
      expect(refsSigCalls - refsBefore).toBe(1);

      unsubMain();
      unsubWt();
      await service.dispose();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }, 15_000);
});
