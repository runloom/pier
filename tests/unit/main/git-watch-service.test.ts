import { EventEmitter } from "node:events";
import { createGitWatchService } from "@main/services/git-watch-service.ts";
import type { GitChangeEvent } from "@shared/contracts/git.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  worktreeSig: string;
  worktreeSigCalls: number;
}

function makeRecorder(): Recorder {
  return {
    headSig: "h0",
    headSigCalls: 0,
    worktreeSig: "w0",
    worktreeSigCalls: 0,
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
      computeHeadSignature: () => {
        rec.headSigCalls += 1;
        return Promise.resolve(rec.headSig);
      },
      computeWorktreeSignature: () => {
        rec.worktreeSigCalls += 1;
        return Promise.resolve(rec.worktreeSig);
      },
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
      computeHeadSignature: () => Promise.resolve(rec.headSig),
      computeWorktreeSignature: () => {
        rec.worktreeSigCalls += 1;
        return Promise.resolve(rec.worktreeSig);
      },
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
      computeHeadSignature: () => Promise.resolve(rec.headSig),
      computeWorktreeSignature: () => Promise.resolve(rec.worktreeSig),
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
      computeHeadSignature: () => Promise.resolve(rec.headSig),
      computeWorktreeSignature: () => Promise.resolve(rec.worktreeSig),
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

  it("30s 兜底轮询:无 fs 事件也会重算签名", async () => {
    const fakeWatcher = new FakeWatcher();
    const rec = makeRecorder();
    const service = createGitWatchService({
      computeHeadSignature: () => Promise.resolve(rec.headSig),
      computeWorktreeSignature: () => {
        rec.worktreeSigCalls += 1;
        return Promise.resolve(rec.worktreeSig);
      },
      fsWatch: () => fakeWatcher,
    });
    service.watch("/repo", () => undefined);
    await vi.runOnlyPendingTimersAsync();
    const baselineCalls = rec.worktreeSigCalls;

    await vi.advanceTimersByTimeAsync(30_000);

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
      computeHeadSignature: () => Promise.resolve(rec.headSig),
      computeWorktreeSignature: () => Promise.resolve(rec.worktreeSig),
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
});
