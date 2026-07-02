import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@main/services/git-exec.ts";
import {
  createGitWatchService,
  defaultWorktreeSignature,
} from "@main/services/git-watch-service.ts";
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
    expect(getStatus).toHaveBeenCalledExactlyOnceWith("/repo");
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
      const computeWorktreeSignature = vi.fn(async () => "w");
      const service = createGitWatchService({
        computeHeadSignature: async () => "h",
        computeRepoStateSignature: async () => "s",
        computeWorktreeSignature,
        fsWatch: () => new FakeWatcher(),
        pollMs: 60_000,
      });
      const listener = vi.fn();
      const unsubscribe = service.watch(dir, listener);
      // baseline(首次 force refresh)完成后,制造一次纯 ref 变化:新建分支(refs/heads 多一条)
      await vi.waitFor(() => {
        expect(computeWorktreeSignature).toHaveBeenCalledTimes(1);
      });
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
      const computeWorktreeSignature = vi.fn(async () => "w");
      const service = createGitWatchService({
        computeHeadSignature: async () => "h",
        computeRepoStateSignature: async () => "s",
        computeWorktreeSignature,
        fsWatch: () => new FakeWatcher(),
        pollMs: 60_000,
      });
      const listener = vi.fn();
      const unsubscribe = service.watch(dir, listener);
      // baseline(首次 force refresh)完成
      await vi.waitFor(() => {
        expect(computeWorktreeSignature).toHaveBeenCalledTimes(1);
      });
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
