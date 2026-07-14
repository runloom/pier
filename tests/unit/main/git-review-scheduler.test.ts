import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import { createGitReviewObserver } from "@main/services/git-review/git-review-observer.ts";
import type { GitReviewObservationEvent } from "@main/services/git-review/git-review-observer-contract.ts";
import {
  createGitReviewScheduler,
  type GitReviewRunContext,
  type GitReviewScheduleKey,
  GitReviewSchedulerError,
} from "@main/services/git-review/git-review-scheduler.ts";
import { describe, expect, it, vi } from "vitest";

const ownerA = { clientId: "renderer", generation: 1, windowRecordId: "w1" };

function key(
  sourceKey: string,
  options: Partial<GitReviewScheduleKey> = {}
): GitReviewScheduleKey {
  return {
    canonicalRequestKey: "request",
    contentRequirement: "full",
    operationKind: "document",
    repositoryKey: "repo-a",
    sourceKey,
    ...options,
  };
}

function createGate<T>(value: T) {
  let resolvePromise: (result: T) => void = () => undefined;
  let rejectPromise: (reason: unknown) => void = () => undefined;
  let context: GitReviewRunContext | undefined;
  let resolved = false;
  const run = vi.fn((runContext: GitReviewRunContext) => {
    context = runContext;
    if (resolved) {
      return Promise.resolve(value);
    }
    return new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
      if (runContext.signal.aborted) {
        reject(runContext.signal.reason);
        return;
      }
      runContext.signal.addEventListener(
        "abort",
        () => reject(runContext.signal.reason),
        { once: true }
      );
    });
  });
  return {
    context: () => context,
    reject: (reason: unknown) => rejectPromise(reason),
    resolve: () => {
      resolved = true;
      resolvePromise(value);
    },
    run,
  };
}

async function flushScheduler(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function expectSchedulerReason(
  promise: Promise<unknown>,
  reason: GitReviewSchedulerError["reason"]
): Promise<void> {
  return promise.then(
    () => {
      throw new Error(`expected scheduler rejection ${reason}`);
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(GitReviewSchedulerError);
      expect((error as GitReviewSchedulerError).reason).toBe(reason);
    }
  );
}

describe("GitReviewScheduler", () => {
  it("相同 key 共享底层任务但 lease 可独立取消", async () => {
    const scheduler = createGitReviewScheduler();
    const gate = createGate("done");
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("same"),
      operationId: "first",
      owner: ownerA,
      run: gate.run,
    });
    const second = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("same"),
      operationId: "second",
      owner: ownerA,
      run: vi.fn(async () => "must-not-run"),
    });
    const firstError = expectSchedulerReason(first.promise, "caller");

    await flushScheduler();
    first.cancel();
    expect(gate.context()?.signal.aborted).toBe(false);
    gate.resolve();

    await firstError;
    await expect(second.promise).resolves.toBe("done");
    expect(gate.run).toHaveBeenCalledOnce();
    expect(scheduler.snapshot()).toEqual({
      activeLeases: 0,
      pendingJobs: 0,
      runningJobs: 0,
    });
  });

  it.each([
    ["同 owner/key/intent", ownerA, key("duplicate"), "manual-read"],
    ["不同 intent", ownerA, key("duplicate"), "watch"],
    ["不同 key", ownerA, key("duplicate-other"), "manual-read"],
    [
      "不同 owner",
      { ...ownerA, windowRecordId: "w2" },
      key("duplicate"),
      "manual-read",
    ],
  ] as const)("active operationId 对 %s 一律拒绝", async (_, owner, requestKey, intent) => {
    const transitions: string[] = [];
    const scheduler = createGitReviewScheduler({
      onTransition(event) {
        transitions.push(`${event.operationId}:${event.state}`);
      },
    });
    const gate = createGate("original");
    const original = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("duplicate"),
      operationId: "duplicate-id",
      owner: ownerA,
      run: gate.run,
    });
    const duplicateRun = vi.fn(async () => "duplicate");
    const duplicate = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent,
      key: requestKey,
      operationId: "duplicate-id",
      owner,
      run: duplicateRun,
    });

    await expectSchedulerReason(duplicate.promise, "duplicate-operation");
    expect(duplicateRun).not.toHaveBeenCalled();
    expect(scheduler.snapshot().activeLeases).toBe(1);
    gate.resolve();
    await expect(original.promise).resolves.toBe("original");
    await flushScheduler();
    expect(transitions).toEqual([
      "duplicate-id:queued",
      "duplicate-id:running",
      "duplicate-id:settled",
    ]);
  });

  it("terminal 后 operationId 可作为新 operation 复用", async () => {
    const scheduler = createGitReviewScheduler();
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("reuse-first"),
      operationId: "reusable-id",
      owner: ownerA,
      run: async () => "first",
    });
    await expect(first.promise).resolves.toBe("first");

    const second = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("reuse-second"),
      operationId: "reusable-id",
      owner: ownerA,
      run: async () => "second",
    });
    await expect(second.promise).resolves.toBe("second");
  });

  it("普通 terminal 的 canonical 回调内保留 operationId，transition 回调可复用", async () => {
    let canonicalDuplicate: { promise: Promise<unknown> } | undefined;
    let replacement: { promise: Promise<unknown> } | undefined;
    let scheduler: ReturnType<typeof createGitReviewScheduler>;
    const observer = createGitReviewObserver({
      logger: vi.fn(),
      onEvent(event) {
        if (
          canonicalDuplicate === undefined &&
          event.operationId === "terminal-reservation" &&
          event.state === "settled"
        ) {
          canonicalDuplicate = scheduler.schedule({
            budget: new GitReviewBudget(),
            intent: "manual-read",
            key: key("terminal-reservation-canonical"),
            operationId: "terminal-reservation",
            owner: ownerA,
            run: vi.fn(async () => "must-not-run"),
          });
        }
      },
    });
    scheduler = createGitReviewScheduler({
      observer,
      onTransition(event) {
        if (
          replacement === undefined &&
          event.operationId === "terminal-reservation" &&
          event.state === "settled"
        ) {
          replacement = scheduler.schedule({
            budget: new GitReviewBudget(),
            intent: "manual-read",
            key: key("terminal-reservation-transition"),
            operationId: "terminal-reservation",
            owner: ownerA,
            run: async () => "replacement",
          });
        }
      },
    });
    const original = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("terminal-reservation-original"),
      observation: {
        queryKind: "uncommitted",
        sourceFingerprintParts: ["repo", "terminal-reservation"],
      },
      operationId: "terminal-reservation",
      owner: ownerA,
      run: async () => "original",
    });

    await expect(original.promise).resolves.toBe("original");
    await expectSchedulerReason(
      canonicalDuplicate?.promise ?? Promise.resolve(),
      "duplicate-operation"
    );
    await expect(replacement?.promise).resolves.toBe("replacement");
  });

  it.each([
    ["conditional", "full"],
    ["full", "conditional"],
  ] as const)("%s 与 %s 两种到达顺序都不合并", async (firstKind, secondKind) => {
    const scheduler = createGitReviewScheduler();
    const firstGate = createGate(firstKind);
    const secondGate = createGate(secondKind);
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("source", { contentRequirement: firstKind }),
      operationId: `op-${firstKind}`,
      owner: ownerA,
      run: firstGate.run,
    });
    const second = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("source", { contentRequirement: secondKind }),
      operationId: `op-${secondKind}`,
      owner: ownerA,
      run: secondGate.run,
    });
    await flushScheduler();
    expect(firstGate.run).toHaveBeenCalledOnce();
    expect(secondGate.run).not.toHaveBeenCalled();

    firstGate.resolve();
    await first.promise;
    await flushScheduler();
    expect(secondGate.run).toHaveBeenCalledOnce();
    secondGate.resolve();
    await expect(second.promise).resolves.toBe(secondKind);
  });

  it("全局 4、单仓库 2、单 source 1 三层 permit 同时生效", async () => {
    const scheduler = createGitReviewScheduler();
    const gates = Array.from({ length: 7 }, (_, index) => createGate(index));
    const leases = gates.map((gate, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(index < 2 ? "same-source" : `source-${index}`, {
          canonicalRequestKey: `request-${index}`,
          repositoryKey: index < 4 ? "repo-a" : `repo-${index}`,
        }),
        operationId: `permit-${index}`,
        owner: ownerA,
        run: gate.run,
      })
    );
    await flushScheduler();

    expect(scheduler.snapshot().runningJobs).toBe(4);
    expect(gates[0]?.run).toHaveBeenCalledOnce();
    expect(gates[1]?.run).not.toHaveBeenCalled();
    const repoAStarts = gates
      .slice(0, 4)
      .filter((gate) => gate.run.mock.calls.length > 0);
    expect(repoAStarts).toHaveLength(2);

    for (const gate of gates) {
      gate.resolve();
      await flushScheduler();
    }
    await Promise.all(leases.map((lease) => lease.promise));
  });

  it("手动请求优先于尚未老化的 watch", async () => {
    const scheduler = createGitReviewScheduler();
    const blockers = [createGate("b1"), createGate("b2")];
    const blockerLeases = blockers.map((gate, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`block-${index}`),
        operationId: `block-${index}`,
        owner: ownerA,
        run: gate.run,
      })
    );
    const watchGate = createGate("watch");
    const watch = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "watch",
      key: key("watch"),
      operationId: "watch",
      owner: ownerA,
      run: watchGate.run,
    });
    const manualGate = createGate("manual");
    const manual = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("manual"),
      operationId: "manual",
      owner: ownerA,
      run: manualGate.run,
    });
    await flushScheduler();

    blockers[0]?.resolve();
    await blockerLeases[0]?.promise;
    await flushScheduler();
    expect(manualGate.run).toHaveBeenCalledOnce();
    expect(watchGate.run).not.toHaveBeenCalled();

    manualGate.resolve();
    await manual.promise;
    await flushScheduler();
    watchGate.resolve();
    blockers[1]?.resolve();
    await Promise.all([watch.promise, blockerLeases[1]?.promise]);
  });

  it("写请求优先于尚未老化的 watch", async () => {
    const scheduler = createGitReviewScheduler();
    const blockers = [createGate("b1"), createGate("b2")];
    const running = blockers.map((gate, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`write-block-${index}`),
        operationId: `write-block-${index}`,
        owner: ownerA,
        run: gate.run,
      })
    );
    const watchGate = createGate("watch");
    const watch = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "watch",
      key: key("write-priority-watch"),
      operationId: "write-priority-watch",
      owner: ownerA,
      run: watchGate.run,
    });
    const writeGate = createGate("write");
    const write = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "write",
      key: key("write-priority"),
      operationId: "write-priority",
      owner: ownerA,
      run: writeGate.run,
    });

    blockers[0]?.resolve();
    await running[0]?.promise;
    await flushScheduler();
    expect(writeGate.run).toHaveBeenCalledOnce();
    expect(watchGate.run).not.toHaveBeenCalled();

    writeGate.resolve();
    blockers[1]?.resolve();
    await Promise.all([write.promise, running[1]?.promise]);
    watchGate.resolve();
    await watch.promise;
  });

  it("watch 等待超过 250ms 后老化为同优先级并保持 FIFO", async () => {
    let now = 0;
    const scheduler = createGitReviewScheduler({ now: () => now });
    const blockers = [createGate("b1"), createGate("b2")];
    const running = blockers.map((gate, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`aging-block-${index}`),
        operationId: `aging-block-${index}`,
        owner: ownerA,
        run: gate.run,
      })
    );
    const agedGate = createGate("aged");
    const aged = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "watch",
      key: key("aged-watch"),
      operationId: "aged-watch",
      owner: ownerA,
      run: agedGate.run,
    });
    now = 251;
    const manualGate = createGate("manual");
    const manual = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("aging-manual"),
      operationId: "aging-manual",
      owner: ownerA,
      run: manualGate.run,
    });

    blockers[0]?.resolve();
    await running[0]?.promise;
    await flushScheduler();
    expect(agedGate.run).toHaveBeenCalledOnce();
    expect(manualGate.run).not.toHaveBeenCalled();

    agedGate.resolve();
    blockers[1]?.resolve();
    await Promise.all([aged.promise, running[1]?.promise]);
    manualGate.resolve();
    await manual.promise;
  });

  it("同 lane 新 watch 替换尚未运行的旧 watch", async () => {
    const scheduler = createGitReviewScheduler();
    const blockers = [createGate("b1"), createGate("b2")];
    const blockerLeases = blockers.map((gate, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`block-${index}`),
        operationId: `tail-block-${index}`,
        owner: ownerA,
        run: gate.run,
      })
    );
    const oldGate = createGate("old");
    const old = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "watch",
      key: key("watch-source", { canonicalRequestKey: "old" }),
      operationId: "old-watch",
      owner: ownerA,
      run: oldGate.run,
    });
    const oldError = expectSchedulerReason(old.promise, "superseded");
    const newGate = createGate("new");
    const newest = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "watch",
      key: key("watch-source", { canonicalRequestKey: "new" }),
      operationId: "new-watch",
      owner: ownerA,
      run: newGate.run,
    });

    await oldError;
    expect(oldGate.run).not.toHaveBeenCalled();
    blockers[0]?.resolve();
    await blockerLeases[0]?.promise;
    await flushScheduler();
    newGate.resolve();
    blockers[1]?.resolve();
    await Promise.all([newest.promise, blockerLeases[1]?.promise]);
  });

  it("同 lane 且完全相同 key 的排队 watch 仍由最新请求替换", async () => {
    const scheduler = createGitReviewScheduler();
    const blockers = [createGate("b1"), createGate("b2")];
    const blockerLeases = blockers.map((gate, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`exact-block-${index}`),
        operationId: `exact-block-${index}`,
        owner: ownerA,
        run: gate.run,
      })
    );
    const oldRun = vi.fn(async () => "old");
    const old = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "watch",
      key: key("exact-watch"),
      operationId: "exact-old",
      owner: ownerA,
      run: oldRun,
    });
    const oldError = expectSchedulerReason(old.promise, "superseded");
    const newestGate = createGate("new");
    const newest = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "watch",
      key: key("exact-watch"),
      operationId: "exact-new",
      owner: ownerA,
      run: newestGate.run,
    });

    await oldError;
    expect(oldRun).not.toHaveBeenCalled();
    blockers[0]?.resolve();
    await blockerLeases[0]?.promise;
    await flushScheduler();
    newestGate.resolve();
    blockers[1]?.resolve();
    await Promise.all([newest.promise, blockerLeases[1]?.promise]);
  });

  it.each([
    "canonical",
    "transition",
  ] as const)("同 lane watch 在 %s terminal 回调重入时只保留最新请求", async (callbackKind) => {
    const blockers = [createGate("b1"), createGate("b2")];
    const nestedGate = createGate("nested");
    let nested: { promise: Promise<unknown> } | undefined;
    let scheduler: ReturnType<typeof createGitReviewScheduler>;
    const scheduleNested = () => {
      if (nested !== undefined) {
        return;
      }
      nested = scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "watch",
        key: key("reentrant-watch", { canonicalRequestKey: "nested" }),
        operationId: `reentrant-watch-nested-${callbackKind}`,
        owner: ownerA,
        run: nestedGate.run,
      });
    };
    const observer = createGitReviewObserver({
      logger: vi.fn(),
      onEvent(event) {
        if (
          callbackKind === "canonical" &&
          event.operationId === `reentrant-watch-old-${callbackKind}` &&
          event.state === "cancelled"
        ) {
          scheduleNested();
        }
      },
    });
    scheduler = createGitReviewScheduler({
      observer,
      onTransition(event) {
        if (
          callbackKind === "transition" &&
          event.operationId === `reentrant-watch-old-${callbackKind}` &&
          event.state === "cancelled"
        ) {
          scheduleNested();
        }
      },
    });
    const blockerLeases = blockers.map((gate, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`reentrant-watch-block-${callbackKind}-${index}`),
        operationId: `reentrant-watch-block-${callbackKind}-${index}`,
        owner: ownerA,
        run: gate.run,
      })
    );
    const old = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "watch",
      key: key("reentrant-watch", { canonicalRequestKey: "old" }),
      observation: {
        queryKind: "uncommitted",
        sourceFingerprintParts: ["repo", callbackKind],
      },
      operationId: `reentrant-watch-old-${callbackKind}`,
      owner: ownerA,
      run: vi.fn(async () => "old"),
    });
    const outerRun = vi.fn(async () => "outer");
    const outer = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "watch",
      key: key("reentrant-watch", { canonicalRequestKey: "outer" }),
      operationId: `reentrant-watch-outer-${callbackKind}`,
      owner: ownerA,
      run: outerRun,
    });

    await Promise.all([
      expectSchedulerReason(old.promise, "superseded"),
      expectSchedulerReason(outer.promise, "superseded"),
    ]);
    expect(scheduler.snapshot()).toEqual({
      activeLeases: 3,
      pendingJobs: 1,
      runningJobs: 2,
    });
    expect(outerRun).not.toHaveBeenCalled();
    blockers[0]?.resolve();
    await blockerLeases[0]?.promise;
    await flushScheduler();
    expect(nestedGate.run).toHaveBeenCalledOnce();
    nestedGate.resolve();
    blockers[1]?.resolve();
    await Promise.all([nested?.promise, blockerLeases[1]?.promise]);
  });

  it("manual 合并进排队 watch 后提升优先级且不再被新 watch 替换", async () => {
    const scheduler = createGitReviewScheduler();
    const blockers = [createGate("b1"), createGate("b2")];
    const blockerLeases = blockers.map((gate, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`promote-block-${index}`),
        operationId: `promote-block-${index}`,
        owner: ownerA,
        run: gate.run,
      })
    );
    const olderWatchGate = createGate("older-watch");
    const olderWatch = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "watch",
      key: key("older-watch"),
      operationId: "older-watch",
      owner: ownerA,
      run: olderWatchGate.run,
    });
    const promotedGate = createGate("promoted");
    const initialWatch = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "watch",
      key: key("promoted-watch"),
      operationId: "initial-watch",
      owner: ownerA,
      run: promotedGate.run,
    });
    const manual = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("promoted-watch"),
      operationId: "promoted-manual",
      owner: ownerA,
      run: vi.fn(async () => "ignored-manual"),
    });
    const newestWatch = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "watch",
      key: key("promoted-watch"),
      operationId: "promoted-new-watch",
      owner: ownerA,
      run: vi.fn(async () => "ignored-watch"),
    });

    blockers[0]?.resolve();
    await blockerLeases[0]?.promise;
    await flushScheduler();
    expect(promotedGate.run).toHaveBeenCalledOnce();
    expect(olderWatchGate.run).not.toHaveBeenCalled();

    promotedGate.resolve();
    blockers[1]?.resolve();
    await Promise.all([
      initialWatch.promise,
      manual.promise,
      newestWatch.promise,
      blockerLeases[1]?.promise,
    ]);
    olderWatchGate.resolve();
    await olderWatch.promise;
  });

  it("排队 lease 的 15 秒预算独立到期且不会运行", async () => {
    vi.useFakeTimers();
    const scheduler = createGitReviewScheduler();
    const blocker = createGate("block");
    const running = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("same-source", { canonicalRequestKey: "running" }),
      operationId: "running",
      owner: ownerA,
      run: blocker.run,
    });
    const queuedRun = vi.fn(async () => "queued");
    const queued = scheduler.schedule({
      budget: new GitReviewBudget({ deadlineAtMs: Date.now() + 25 }),
      intent: "manual-read",
      key: key("same-source", { canonicalRequestKey: "queued" }),
      operationId: "queued",
      owner: ownerA,
      run: queuedRun,
    });
    const queuedError = expectSchedulerReason(queued.promise, "timeout");

    await vi.advanceTimersByTimeAsync(25);

    await queuedError;
    expect(queuedRun).not.toHaveBeenCalled();
    blocker.resolve();
    await running.promise;
    vi.useRealTimers();
  });

  it("releaseOwner 只释放同一 window generation 的租约", async () => {
    const scheduler = createGitReviewScheduler();
    const gate = createGate("done");
    const oldLease = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("owner"),
      operationId: "owner-old",
      owner: ownerA,
      run: gate.run,
    });
    const newOwner = { ...ownerA, generation: 2 };
    const newLease = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("owner"),
      operationId: "owner-new",
      owner: newOwner,
      run: gate.run,
    });
    const oldError = expectSchedulerReason(oldLease.promise, "owner-disposed");

    expect(scheduler.releaseOwner(ownerA)).toBe(1);
    await oldError;
    expect(gate.context()?.signal.aborted).toBe(false);
    gate.resolve();
    await expect(newLease.promise).resolves.toBe("done");
  });

  it.each([
    "canonical",
    "transition",
  ] as const)("releaseOwner 的 %s terminal 回调内拒绝同 owner，返回后恢复复用", async (callbackKind) => {
    let reentrant: { promise: Promise<unknown> } | undefined;
    let scheduler: ReturnType<typeof createGitReviewScheduler>;
    const scheduleReentrant = () => {
      if (reentrant !== undefined) {
        return;
      }
      expect(scheduler.releaseOwner(ownerA)).toBe(0);
      reentrant = scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`release-owner-reentrant-${callbackKind}`),
        operationId: `release-owner-reentrant-${callbackKind}`,
        owner: ownerA,
        run: vi.fn(async () => "must-not-run"),
      });
    };
    const originalId = `release-owner-original-${callbackKind}`;
    const observer = createGitReviewObserver({
      logger: vi.fn(),
      onEvent(event) {
        if (
          callbackKind === "canonical" &&
          event.operationId === originalId &&
          event.state === "cancelled"
        ) {
          scheduleReentrant();
        }
      },
    });
    scheduler = createGitReviewScheduler({
      observer,
      onTransition(event) {
        if (
          callbackKind === "transition" &&
          event.operationId === originalId &&
          event.state === "cancelled"
        ) {
          scheduleReentrant();
        }
      },
    });
    const original = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key(`release-owner-original-${callbackKind}`),
      observation: {
        queryKind: "uncommitted",
        sourceFingerprintParts: ["repo", callbackKind],
      },
      operationId: originalId,
      owner: ownerA,
      run: vi.fn(async () => "must-not-run"),
    });

    expect(scheduler.releaseOwner(ownerA)).toBe(1);
    await expectSchedulerReason(original.promise, "owner-disposed");
    await expectSchedulerReason(
      reentrant?.promise ?? Promise.resolve(),
      "owner-disposed"
    );
    const postRelease = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key(`release-owner-post-${callbackKind}`),
      operationId: `release-owner-post-${callbackKind}`,
      owner: ownerA,
      run: async () => "post-release",
    });
    await expect(postRelease.promise).resolves.toBe("post-release");
  });

  it.each(
    (["canonical", "transition"] as const).flatMap((callbackKind) =>
      (["queued", "running", "terminal"] as const).map(
        (phase) => [callbackKind, phase] as const
      )
    )
  )("外层 %s %s 事务中的 releaseOwner 持有延后 terminal delivery guard", async (callbackKind, phase) => {
    const victimGate = createGate("victim");
    const outerId = `owner-matrix-outer-${callbackKind}-${phase}`;
    const victimId = `owner-matrix-victim-${callbackKind}-${phase}`;
    let released = false;
    let canonicalReentrant: { promise: Promise<unknown> } | undefined;
    let transitionReentrant: { promise: Promise<unknown> } | undefined;
    let scheduler: ReturnType<typeof createGitReviewScheduler>;
    const releaseAtPhase = (state: string) => {
      const targetState = phase === "terminal" ? "settled" : phase;
      if (!released && state === targetState) {
        released = true;
        expect(scheduler.releaseOwner(ownerA)).toBeGreaterThan(0);
      }
    };
    const scheduleReentrant = (channel: "canonical" | "transition") => {
      scheduler.releaseOwner(ownerA);
      return scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`owner-matrix-reentrant-${channel}-${callbackKind}-${phase}`),
        operationId: `owner-matrix-reentrant-${channel}-${callbackKind}-${phase}`,
        owner: ownerA,
        run: vi.fn(async () => "must-not-run"),
      });
    };
    const observer = createGitReviewObserver({
      logger: vi.fn(),
      onEvent(event) {
        if (callbackKind === "canonical" && event.operationId === outerId) {
          releaseAtPhase(event.state);
        }
        if (
          canonicalReentrant === undefined &&
          event.operationId === victimId &&
          event.state === "cancelled"
        ) {
          canonicalReentrant = scheduleReentrant("canonical");
        }
      },
    });
    scheduler = createGitReviewScheduler({
      observer,
      onTransition(event) {
        if (callbackKind === "transition" && event.operationId === outerId) {
          releaseAtPhase(event.state);
        }
        if (
          transitionReentrant === undefined &&
          event.operationId === victimId &&
          event.state === "cancelled"
        ) {
          transitionReentrant = scheduleReentrant("transition");
        }
      },
    });
    const victim = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key(`owner-matrix-victim-${callbackKind}-${phase}`),
      observation: {
        queryKind: "uncommitted",
        sourceFingerprintParts: ["repo", "victim", callbackKind, phase],
      },
      operationId: victimId,
      owner: ownerA,
      run: victimGate.run,
    });
    const outer = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key(`owner-matrix-outer-${callbackKind}-${phase}`),
      observation: {
        queryKind: "uncommitted",
        sourceFingerprintParts: ["repo", callbackKind, phase],
      },
      operationId: outerId,
      owner: ownerA,
      run: async () => "outer",
    });

    await expectSchedulerReason(victim.promise, "owner-disposed");
    if (phase === "terminal") {
      await expect(outer.promise).resolves.toBe("outer");
    } else {
      await expectSchedulerReason(outer.promise, "owner-disposed");
    }
    await Promise.all([
      expectSchedulerReason(
        canonicalReentrant?.promise ?? Promise.resolve(),
        "owner-disposed"
      ),
      expectSchedulerReason(
        transitionReentrant?.promise ?? Promise.resolve(),
        "owner-disposed"
      ),
    ]);
    expect(released).toBe(true);
    const postTransaction = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key(`owner-matrix-post-${callbackKind}-${phase}`),
      operationId: `owner-matrix-post-${callbackKind}-${phase}`,
      owner: ownerA,
      run: async () => "post-transaction",
    });
    await expect(postTransaction.promise).resolves.toBe("post-transaction");
  });

  it("晚加入 dedupe lease 先扣历史输出，超限不影响原 lease", async () => {
    const scheduler = createGitReviewScheduler();
    const gate = createGate("done");
    const first = scheduler.schedule({
      budget: new GitReviewBudget({ maxOutputBytes: 10 }),
      intent: "manual-read",
      key: key("bytes"),
      operationId: "bytes-first",
      owner: ownerA,
      run: gate.run,
    });
    await flushScheduler();
    expect(gate.context()?.budget.consumeOutputBytes(3)).toBe("ok");

    const late = scheduler.schedule({
      budget: new GitReviewBudget({ maxOutputBytes: 2 }),
      intent: "manual-read",
      key: key("bytes"),
      operationId: "bytes-late",
      owner: ownerA,
      run: vi.fn(async () => "late"),
    });

    await expectSchedulerReason(late.promise, "output-limit");
    expect(gate.context()?.signal.aborted).toBe(false);
    gate.resolve();
    await expect(first.promise).resolves.toBe("done");
  });

  it("非法输出增量零副作用且后续 late lease 按未污染历史正常加入", async () => {
    const scheduler = createGitReviewScheduler();
    const gate = createGate("done");
    const first = scheduler.schedule({
      budget: new GitReviewBudget({ maxOutputBytes: 1 }),
      intent: "manual-read",
      key: key("output-invalid-delta"),
      operationId: "output-invalid-delta-first",
      owner: ownerA,
      run: gate.run,
    });
    await flushScheduler();

    expect(() => gate.context()?.budget.consumeOutputBytes(-1)).toThrow(
      "output byte delta must be a non-negative safe integer"
    );
    expect(() => gate.context()?.budget.consumeOutputBytes(Number.NaN)).toThrow(
      "output byte delta must be a non-negative safe integer"
    );

    const late = scheduler.schedule({
      budget: new GitReviewBudget({ maxOutputBytes: 1 }),
      intent: "manual-read",
      key: key("output-invalid-delta"),
      operationId: "output-invalid-delta-late",
      owner: ownerA,
      run: vi.fn(async () => "must-not-run"),
    });
    expect(gate.context()?.budget.consumeOutputBytes(1)).toBe("ok");

    gate.resolve();
    await expect(first.promise).resolves.toBe("done");
    await expect(late.promise).resolves.toBe("done");
  });

  it("输出累计溢出饱和到 MAX_SAFE 并让重入 late admission 稳定失败", async () => {
    const gate = createGate("done");
    let late: { promise: Promise<unknown> } | undefined;
    const scheduler = createGitReviewScheduler({
      onTransition(event) {
        if (
          late === undefined &&
          event.operationId === "output-overflow-first" &&
          event.state === "cancelled" &&
          event.terminalReason === "output-limit"
        ) {
          late = scheduler.schedule({
            budget: new GitReviewBudget(),
            intent: "manual-read",
            key: key("output-overflow"),
            operationId: "output-overflow-late",
            owner: ownerA,
            run: vi.fn(async () => "must-not-run"),
          });
        }
      },
    });
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("output-overflow"),
      operationId: "output-overflow-first",
      owner: ownerA,
      run: gate.run,
    });
    const second = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("output-overflow"),
      operationId: "output-overflow-second",
      owner: ownerA,
      run: vi.fn(async () => "must-not-run"),
    });
    const firstError = expectSchedulerReason(first.promise, "output-limit");
    const secondError = expectSchedulerReason(second.promise, "output-limit");
    await flushScheduler();

    expect(
      gate.context()?.budget.consumeOutputBytes(Number.MAX_SAFE_INTEGER)
    ).toBe("output-limit");
    await Promise.all([firstError, secondError]);
    await expectSchedulerReason(
      late?.promise ?? Promise.resolve(),
      "output-limit"
    );
    expect(gate.context()?.budget.failureReason()).toBe("output-limit");
    expect(gate.context()?.budget.consumeOutputBytes(1)).toBe("output-limit");
  });

  it("attached leases 输出预算分化时只终止不足 lease", async () => {
    const scheduler = createGitReviewScheduler();
    const gate = createGate("done");
    const first = scheduler.schedule({
      budget: new GitReviewBudget({ maxOutputBytes: 10 }),
      intent: "manual-read",
      key: key("output-budget-diverged"),
      operationId: "output-diverged-first",
      owner: ownerA,
      run: gate.run,
    });
    const second = scheduler.schedule({
      budget: new GitReviewBudget({ maxOutputBytes: 2 }),
      intent: "manual-read",
      key: key("output-budget-diverged"),
      operationId: "output-diverged-second",
      owner: ownerA,
      run: vi.fn(async () => "must-not-run"),
    });
    const firstError = expectSchedulerReason(first.promise, "output-limit");
    const secondError = expectSchedulerReason(second.promise, "output-limit");
    await flushScheduler();

    expect(gate.context()?.budget.consumeOutputBytes(3)).toBe("ok");
    await secondError;
    expect(gate.context()?.signal.aborted).toBe(false);
    expect(gate.context()?.budget.consumeOutputBytes(7)).toBe("ok");
    expect(gate.context()?.budget.consumeOutputBytes(1)).toBe("output-limit");

    await firstError;
    expect(gate.context()?.signal.aborted).toBe(true);
    await flushScheduler();
  });

  it("晚加入 dedupe lease 补扣历史逻辑文件，超限不污染原 lease", async () => {
    const scheduler = createGitReviewScheduler();
    const gate = createGate("done");
    const first = scheduler.schedule({
      budget: new GitReviewBudget({ maxFiles: 20 }),
      intent: "manual-read",
      key: key("file-budget"),
      operationId: "files-first",
      owner: ownerA,
      run: gate.run,
    });
    await flushScheduler();
    expect(gate.context()?.budget.tryConsumeFiles(10)).toBe(true);

    const late = scheduler.schedule({
      budget: new GitReviewBudget({ maxFiles: 5 }),
      intent: "manual-read",
      key: key("file-budget"),
      operationId: "files-late",
      owner: ownerA,
      run: vi.fn(async () => "late"),
    });

    await expectSchedulerReason(late.promise, "file-limit");
    expect(gate.context()?.budget.tryConsumeFiles(10)).toBe(true);
    gate.resolve();
    await expect(first.promise).resolves.toBe("done");
  });

  it("attached leases 文件预算分化时只终止不足 lease", async () => {
    const scheduler = createGitReviewScheduler();
    const gate = createGate("done");
    const first = scheduler.schedule({
      budget: new GitReviewBudget({ maxFiles: 20 }),
      intent: "manual-read",
      key: key("file-budget-diverged"),
      operationId: "files-diverged-first",
      owner: ownerA,
      run: gate.run,
    });
    const second = scheduler.schedule({
      budget: new GitReviewBudget({ maxFiles: 5 }),
      intent: "manual-read",
      key: key("file-budget-diverged"),
      operationId: "files-diverged-second",
      owner: ownerA,
      run: vi.fn(async () => "must-not-run"),
    });
    const firstError = expectSchedulerReason(first.promise, "file-limit");
    const secondError = expectSchedulerReason(second.promise, "file-limit");
    await flushScheduler();

    expect(gate.context()?.budget.tryConsumeFiles(6)).toBe(true);
    await secondError;
    expect(gate.context()?.signal.aborted).toBe(false);
    expect(gate.context()?.budget.tryConsumeFiles(14)).toBe(true);
    expect(gate.context()?.budget.tryConsumeFiles()).toBe(false);

    await firstError;
    expect(gate.context()?.signal.aborted).toBe(true);
    await flushScheduler();
  });

  it("所有 attached leases 文件预算耗尽后停止共享执行", async () => {
    const scheduler = createGitReviewScheduler();
    const gate = createGate("done");
    const first = scheduler.schedule({
      budget: new GitReviewBudget({ maxFiles: 5 }),
      intent: "manual-read",
      key: key("file-budget-exhausted"),
      operationId: "files-exhausted-first",
      owner: ownerA,
      run: gate.run,
    });
    const second = scheduler.schedule({
      budget: new GitReviewBudget({ maxFiles: 5 }),
      intent: "manual-read",
      key: key("file-budget-exhausted"),
      operationId: "files-exhausted-second",
      owner: ownerA,
      run: vi.fn(async () => "must-not-run"),
    });
    const firstError = expectSchedulerReason(first.promise, "file-limit");
    const secondError = expectSchedulerReason(second.promise, "file-limit");
    await flushScheduler();

    expect(gate.context()?.budget.tryConsumeFiles(5)).toBe(true);
    expect(gate.context()?.budget.tryConsumeFiles()).toBe(false);

    await Promise.all([firstError, secondError]);
    expect(gate.context()?.signal.aborted).toBe(true);
    await flushScheduler();
  });

  it("旧文件 leases 全耗尽时 terminal 回调附着的新 lease 消费当前文件", async () => {
    const gate = createGate("done");
    const replacementRun = vi.fn(async () => "must-not-run");
    let replacement: { promise: Promise<unknown> } | undefined;
    const scheduler = createGitReviewScheduler({
      onTransition(event) {
        if (
          event.operationId === "file-reentrant-first" &&
          event.state === "cancelled" &&
          event.terminalReason === "file-limit"
        ) {
          replacement = scheduler.schedule({
            budget: new GitReviewBudget({ maxFiles: 10 }),
            intent: "manual-read",
            key: key("file-budget-reentrant"),
            operationId: "file-reentrant-replacement",
            owner: ownerA,
            run: replacementRun,
          });
        }
      },
    });
    const first = scheduler.schedule({
      budget: new GitReviewBudget({ maxFiles: 1 }),
      intent: "manual-read",
      key: key("file-budget-reentrant"),
      operationId: "file-reentrant-first",
      owner: ownerA,
      run: gate.run,
    });
    const second = scheduler.schedule({
      budget: new GitReviewBudget({ maxFiles: 1 }),
      intent: "manual-read",
      key: key("file-budget-reentrant"),
      operationId: "file-reentrant-second",
      owner: ownerA,
      run: vi.fn(async () => "must-not-run"),
    });
    const firstError = expectSchedulerReason(first.promise, "file-limit");
    const secondError = expectSchedulerReason(second.promise, "file-limit");
    await flushScheduler();

    expect(gate.context()?.budget.tryConsumeFiles()).toBe(true);
    expect(gate.context()?.budget.tryConsumeFiles()).toBe(true);
    await Promise.all([firstError, secondError]);
    expect(gate.context()?.signal.aborted).toBe(false);
    expect(replacement).toBeDefined();

    gate.resolve();
    await expect(replacement?.promise).resolves.toBe("done");
    expect(replacementRun).not.toHaveBeenCalled();
  });

  it("历史输出补扣后到期的 late lease 保留 timeout 原因", async () => {
    const gate = createGate("done");
    const scheduler = createGitReviewScheduler();
    const first = scheduler.schedule({
      budget: new GitReviewBudget({ maxOutputBytes: 10 }),
      intent: "manual-read",
      key: key("late-timeout-during-admission"),
      operationId: "late-timeout-first",
      owner: ownerA,
      run: gate.run,
    });
    await flushScheduler();
    expect(gate.context()?.budget.consumeOutputBytes(3)).toBe("ok");

    let nowReads = 0;
    const budget = new GitReviewBudget({
      deadlineAtMs: 100,
      now: () => {
        nowReads += 1;
        return nowReads < 3 ? 0 : 100;
      },
    });
    const run = vi.fn(async () => "must-not-run");
    const lease = scheduler.schedule({
      budget,
      intent: "manual-read",
      key: key("late-timeout-during-admission"),
      operationId: "late-timeout-during-admission",
      owner: ownerA,
      run,
    });

    await expectSchedulerReason(lease.promise, "timeout");
    expect(run).not.toHaveBeenCalled();
    expect(gate.context()?.signal.aborted).toBe(false);
    gate.resolve();
    await expect(first.promise).resolves.toBe("done");
  });

  it("成功与失败结算的微任务重入都会创建新 job", async () => {
    const scheduler = createGitReviewScheduler();
    const successRun = vi.fn(async () => "first");
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("reentrant-success"),
      operationId: "reentrant-success-1",
      owner: ownerA,
      run: successRun,
    });
    const secondRun = vi.fn(async () => "second");
    const successChain = first.promise.then(
      () =>
        scheduler.schedule({
          budget: new GitReviewBudget(),
          intent: "manual-read",
          key: key("reentrant-success"),
          operationId: "reentrant-success-2",
          owner: ownerA,
          run: secondRun,
        }).promise
    );
    await expect(successChain).resolves.toBe("second");
    expect(successRun).toHaveBeenCalledOnce();
    expect(secondRun).toHaveBeenCalledOnce();

    const failureRun = vi.fn(async () => {
      throw new Error("first failed");
    });
    const failed = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("reentrant-failure"),
      operationId: "reentrant-failure-1",
      owner: ownerA,
      run: failureRun,
    });
    const recoveryRun = vi.fn(async () => "recovered");
    const recovery = failed.promise.catch(
      () =>
        scheduler.schedule({
          budget: new GitReviewBudget(),
          intent: "manual-read",
          key: key("reentrant-failure"),
          operationId: "reentrant-failure-2",
          owner: ownerA,
          run: recoveryRun,
        }).promise
    );
    await expect(recovery).resolves.toBe("recovered");
    expect(recoveryRun).toHaveBeenCalledOnce();
  });

  it("正常 success/failure settle 不复用 cancellation signal 表达终态", async () => {
    const scheduler = createGitReviewScheduler();
    let successSignal: AbortSignal | undefined;
    const success = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("settle-signal-success"),
      operationId: "settle-signal-success",
      owner: ownerA,
      run: async ({ signal }) => {
        successSignal = signal;
        return "done";
      },
    });
    await expect(success.promise).resolves.toBe("done");
    expect(successSignal?.aborted).toBe(false);

    const runError = new Error("failed");
    let failureSignal: AbortSignal | undefined;
    const failure = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("settle-signal-failure"),
      operationId: "settle-signal-failure",
      owner: ownerA,
      run: async ({ signal }) => {
        failureSignal = signal;
        throw runError;
      },
    });
    await expect(failure.promise).rejects.toBe(runError);
    expect(failureSignal?.aborted).toBe(false);
  });

  it("最后 lease cancel 后同栈重试不会绑定已 abort 的旧 job", async () => {
    const scheduler = createGitReviewScheduler();
    const oldGate = createGate("old");
    const old = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("cancel-retry"),
      operationId: "cancel-old",
      owner: ownerA,
      run: oldGate.run,
    });
    const oldError = expectSchedulerReason(old.promise, "caller");
    await flushScheduler();
    old.cancel();
    const newRun = vi.fn(async () => "new");
    const retried = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("cancel-retry"),
      operationId: "cancel-new",
      owner: ownerA,
      run: newRun,
    });

    await oldError;
    await expect(retried.promise).resolves.toBe("new");
    expect(newRun).toHaveBeenCalledOnce();
  });

  it("每个 operation 只发布一次 terminal 并立即移出 registry", async () => {
    const transitions: string[] = [];
    const scheduler = createGitReviewScheduler({
      onTransition(event) {
        transitions.push(`${event.operationId}:${event.state}`);
      },
    });
    const lease = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("terminal"),
      operationId: "terminal",
      owner: ownerA,
      run: async () => "done",
    });

    await expect(lease.promise).resolves.toBe("done");
    await flushScheduler();

    expect(transitions).toEqual([
      "terminal:queued",
      "terminal:running",
      "terminal:settled",
    ]);
    expect(scheduler.cancel("terminal")).toBe(false);
    expect(scheduler.snapshot().activeLeases).toBe(0);
  });

  it("scheduler 是 lifecycle 唯一写入口，observer 端到端只收到一次终态", async () => {
    const events: GitReviewObservationEvent[] = [];
    const observer = createGitReviewObserver({
      logger: vi.fn(),
      onEvent: (event) => events.push(event),
    });
    const scheduler = createGitReviewScheduler({ observer });
    const lease = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("observed"),
      observation: {
        classifyResult: () => ({ result: "not-modified" }),
        queryKind: "uncommitted",
        sourceFingerprintParts: ["/private/repo", "secret.ts"],
      },
      operationId: "observed",
      owner: ownerA,
      run: async () => "done",
    });

    await lease.promise;
    await flushScheduler();

    expect(events.map((event) => event.state)).toEqual([
      "queued",
      "running",
      "settled",
    ]);
    expect(events.at(-1)?.result).toBe("not-modified");
    expect(observer.snapshot().active).toBe(0);
    expect(JSON.stringify(events)).not.toContain("/private/repo");
    expect(JSON.stringify(events)).not.toContain("secret.ts");
  });

  it("canonical observer 先闭合，terminal transition 同栈可复用 operationId", async () => {
    const events: GitReviewObservationEvent[] = [];
    const observer = createGitReviewObserver({
      logger: vi.fn(),
      onEvent: (event) => events.push(event),
    });
    let replacement: { promise: Promise<unknown> } | undefined;
    let replaced = false;
    const scheduler = createGitReviewScheduler({
      observer,
      onTransition(event) {
        if (event.operationId !== "reentrant-id" || event.state !== "settled") {
          return;
        }
        if (replaced) {
          return;
        }
        replaced = true;
        replacement = scheduler.schedule({
          budget: new GitReviewBudget(),
          intent: "manual-read",
          key: key("reentrant-observer-new"),
          observation: {
            queryKind: "uncommitted",
            sourceFingerprintParts: ["repo", "new"],
          },
          operationId: "reentrant-id",
          owner: ownerA,
          run: async () => "new",
        });
      },
    });
    const original = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("reentrant-observer-old"),
      observation: {
        queryKind: "uncommitted",
        sourceFingerprintParts: ["repo", "old"],
      },
      operationId: "reentrant-id",
      owner: ownerA,
      run: async () => "old",
    });

    await expect(original.promise).resolves.toBe("old");
    await expect(replacement?.promise).resolves.toBe("new");
    await flushScheduler();
    expect(events.map((event) => event.state)).toEqual([
      "queued",
      "running",
      "settled",
      "queued",
      "running",
      "settled",
    ]);
    expect(observer.snapshot().active).toBe(0);
  });

  it("最后 lease cancel 先拆旧 job，terminal 回调同栈同 key 创建新 job", async () => {
    const oldGate = createGate("old");
    const replacementRun = vi.fn(async () => "new");
    let replacement: { promise: Promise<unknown> } | undefined;
    const scheduler = createGitReviewScheduler({
      onTransition(event) {
        if (
          event.operationId === "cancel-reentrant-old" &&
          event.state === "cancelled"
        ) {
          replacement = scheduler.schedule({
            budget: new GitReviewBudget(),
            intent: "manual-read",
            key: key("cancel-reentrant"),
            operationId: "cancel-reentrant-new",
            owner: ownerA,
            run: replacementRun,
          });
        }
      },
    });
    const original = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("cancel-reentrant"),
      operationId: "cancel-reentrant-old",
      owner: ownerA,
      run: oldGate.run,
    });
    const originalError = expectSchedulerReason(original.promise, "caller");
    await flushScheduler();

    original.cancel();

    await originalError;
    await expect(replacement?.promise).resolves.toBe("new");
    expect(replacementRun).toHaveBeenCalledOnce();
  });

  it.each([
    "success",
    "failure",
  ] as const)("%s classifier 抛错时回退 internal failure 并关闭 observer", async (outcome) => {
    const events: GitReviewObservationEvent[] = [];
    const observer = createGitReviewObserver({
      logger: vi.fn(),
      onEvent: (event) => events.push(event),
    });
    const scheduler = createGitReviewScheduler({ observer });
    const classifiedError = new Error("classifier failed");
    const runError = new Error("run failed");
    const lease = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key(`classifier-${outcome}`),
      observation: {
        classifyError: () => {
          throw classifiedError;
        },
        classifyResult: () => {
          throw classifiedError;
        },
        queryKind: "uncommitted",
        sourceFingerprintParts: ["repo", outcome],
      },
      operationId: `classifier-${outcome}`,
      owner: ownerA,
      run:
        outcome === "success"
          ? async () => "done"
          : async () => {
              throw runError;
            },
    });

    if (outcome === "success") {
      await expect(lease.promise).resolves.toBe("done");
    } else {
      await expect(lease.promise).rejects.toBe(runError);
    }
    await flushScheduler();
    expect(events.at(-1)).toMatchObject({
      failureReason: "internal",
      result: "failure",
      state: "settled",
    });
    expect(observer.snapshot().active).toBe(0);
  });

  it("admission 前 timeout 也由 scheduler 闭合 observer 终态", async () => {
    const events: GitReviewObservationEvent[] = [];
    const observer = createGitReviewObserver({
      logger: vi.fn(),
      onEvent: (event) => events.push(event),
    });
    const scheduler = createGitReviewScheduler({ observer });
    const lease = scheduler.schedule({
      budget: new GitReviewBudget({ deadlineAtMs: Date.now() - 1 }),
      intent: "manual-read",
      key: key("expired"),
      observation: {
        queryKind: "uncommitted",
        sourceFingerprintParts: ["repo", "expired"],
      },
      operationId: "expired",
      owner: ownerA,
      run: vi.fn(async () => "never"),
    });

    await expectSchedulerReason(lease.promise, "timeout");
    expect(events.map((event) => event.state)).toEqual(["queued", "cancelled"]);
    expect(events.at(-1)?.abortReason).toBe("timeout");
    expect(observer.snapshot().active).toBe(0);
  });

  it("即时拒绝先闭合 observer，terminal 回调同栈可复用 operationId", async () => {
    const events: GitReviewObservationEvent[] = [];
    let canonicalDuplicate: { promise: Promise<unknown> } | undefined;
    let scheduler: ReturnType<typeof createGitReviewScheduler>;
    const observer = createGitReviewObserver({
      logger: vi.fn(),
      onEvent(event) {
        events.push(event);
        if (
          canonicalDuplicate === undefined &&
          event.operationId === "immediate-reentrant" &&
          event.state === "cancelled"
        ) {
          canonicalDuplicate = scheduler.schedule({
            budget: new GitReviewBudget(),
            intent: "manual-read",
            key: key("immediate-reentrant-canonical"),
            operationId: "immediate-reentrant",
            owner: ownerA,
            run: vi.fn(async () => "must-not-run"),
          });
        }
      },
    });
    let queuedDuplicate: { promise: Promise<unknown> } | undefined;
    let queuedAttempted = false;
    let replacement: { promise: Promise<unknown> } | undefined;
    let replaced = false;
    scheduler = createGitReviewScheduler({
      observer,
      onTransition(event) {
        if (
          !queuedAttempted &&
          event.operationId === "immediate-reentrant" &&
          event.state === "queued"
        ) {
          queuedAttempted = true;
          queuedDuplicate = scheduler.schedule({
            budget: new GitReviewBudget(),
            intent: "manual-read",
            key: key("immediate-reentrant-duplicate"),
            operationId: "immediate-reentrant",
            owner: ownerA,
            run: vi.fn(async () => "must-not-run"),
          });
          return;
        }
        if (
          replaced ||
          event.operationId !== "immediate-reentrant" ||
          event.state !== "cancelled"
        ) {
          return;
        }
        replaced = true;
        replacement = scheduler.schedule({
          budget: new GitReviewBudget(),
          intent: "manual-read",
          key: key("immediate-reentrant-new"),
          observation: {
            queryKind: "uncommitted",
            sourceFingerprintParts: ["repo", "new"],
          },
          operationId: "immediate-reentrant",
          owner: ownerA,
          run: async () => "new",
        });
      },
    });
    const rejected = scheduler.schedule({
      budget: new GitReviewBudget({ deadlineAtMs: Date.now() - 1 }),
      intent: "manual-read",
      key: key("immediate-reentrant-old"),
      observation: {
        queryKind: "uncommitted",
        sourceFingerprintParts: ["repo", "old"],
      },
      operationId: "immediate-reentrant",
      owner: ownerA,
      run: vi.fn(async () => "never"),
    });

    await expectSchedulerReason(rejected.promise, "timeout");
    await expectSchedulerReason(
      queuedDuplicate?.promise ?? Promise.resolve(),
      "duplicate-operation"
    );
    await expectSchedulerReason(
      canonicalDuplicate?.promise ?? Promise.resolve(),
      "duplicate-operation"
    );
    await expect(replacement?.promise).resolves.toBe("new");
    await flushScheduler();
    expect(events.map((event) => event.state)).toEqual([
      "queued",
      "cancelled",
      "queued",
      "running",
      "settled",
    ]);
    expect(observer.snapshot().active).toBe(0);
  });

  it("新 job queued 回调自取消不会入队或执行 run", async () => {
    const transitions: string[] = [];
    const run = vi.fn(async () => "must-not-run");
    const scheduler = createGitReviewScheduler({
      onTransition(event) {
        transitions.push(`${event.operationId}:${event.state}`);
        if (
          event.operationId === "queued-self-cancel" &&
          event.state === "queued"
        ) {
          scheduler.cancel(event.operationId);
        }
      },
    });
    const lease = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("queued-self-cancel"),
      operationId: "queued-self-cancel",
      owner: ownerA,
      run,
    });

    await expectSchedulerReason(lease.promise, "caller");
    await flushScheduler();
    expect(run).not.toHaveBeenCalled();
    expect(transitions).toEqual([
      "queued-self-cancel:queued",
      "queued-self-cancel:cancelled",
    ]);
    expect(scheduler.snapshot()).toEqual({
      activeLeases: 0,
      pendingJobs: 0,
      runningJobs: 0,
    });
  });

  it("canonical observer queued 回调自取消同样不会执行 run", async () => {
    const events: GitReviewObservationEvent[] = [];
    const transitions: string[] = [];
    const run = vi.fn(async () => "must-not-run");
    let scheduler: ReturnType<typeof createGitReviewScheduler>;
    const observer = createGitReviewObserver({
      logger: vi.fn(),
      onEvent(event) {
        events.push(event);
        if (
          event.operationId === "observer-queued-cancel" &&
          event.state === "queued"
        ) {
          scheduler.cancel(event.operationId);
        }
      },
    });
    scheduler = createGitReviewScheduler({
      observer,
      onTransition(event) {
        transitions.push(event.state);
      },
    });
    const lease = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("observer-queued-cancel"),
      observation: {
        queryKind: "uncommitted",
        sourceFingerprintParts: ["repo", "observer-queued-cancel"],
      },
      operationId: "observer-queued-cancel",
      owner: ownerA,
      run,
    });

    await expectSchedulerReason(lease.promise, "caller");
    expect(run).not.toHaveBeenCalled();
    expect(events.map((event) => event.state)).toEqual(["queued", "cancelled"]);
    expect(transitions).toEqual(["queued", "cancelled"]);
    expect(observer.snapshot().active).toBe(0);
  });

  it("不同 key 的 queued 回调重入提前 dispatch 时每个 lease 只发布一次 running", async () => {
    const transitions: string[] = [];
    let nested: { promise: Promise<unknown> } | undefined;
    const scheduler = createGitReviewScheduler({
      onTransition(event) {
        transitions.push(`${event.operationId}:${event.state}`);
        if (
          nested === undefined &&
          event.operationId === "different-key-outer" &&
          event.state === "queued"
        ) {
          nested = scheduler.schedule({
            budget: new GitReviewBudget(),
            intent: "manual-read",
            key: key("different-key-nested"),
            operationId: "different-key-nested",
            owner: ownerA,
            run: async () => "nested",
          });
        }
      },
    });
    const outer = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("different-key-outer"),
      operationId: "different-key-outer",
      owner: ownerA,
      run: async () => "outer",
    });

    await expect(outer.promise).resolves.toBe("outer");
    await expect(nested?.promise).resolves.toBe("nested");
    expect(
      transitions.filter((entry) => entry === "different-key-outer:running")
    ).toHaveLength(1);
    expect(
      transitions.filter((entry) => entry === "different-key-nested:running")
    ).toHaveLength(1);
  });

  it("schedule 返回后立即 cancel 不进入 run 微任务且 permit 只释放一次", async () => {
    const run = vi.fn(async () => "must-not-run");
    const scheduler = createGitReviewScheduler();
    const lease = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("immediate-cancel"),
      operationId: "immediate-cancel",
      owner: ownerA,
      run,
    });

    lease.cancel();
    await expectSchedulerReason(lease.promise, "caller");
    await flushScheduler();
    expect(run).not.toHaveBeenCalled();
    expect(scheduler.snapshot()).toEqual({
      activeLeases: 0,
      pendingJobs: 0,
      runningJobs: 0,
    });
    const next = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("immediate-cancel-next"),
      operationId: "immediate-cancel-next",
      owner: ownerA,
      run: async () => "next",
    });
    await expect(next.promise).resolves.toBe("next");
  });

  it("新 job queued 回调内同 key 请求只共享一个底层 job", async () => {
    const sharedRun = vi.fn(async () => "shared");
    const duplicateRun = vi.fn(async () => "must-not-run");
    let nested: { promise: Promise<unknown> } | undefined;
    let attached = false;
    const scheduler = createGitReviewScheduler({
      onTransition(event) {
        if (
          attached ||
          event.operationId !== "queued-shared-first" ||
          event.state !== "queued"
        ) {
          return;
        }
        attached = true;
        nested = scheduler.schedule({
          budget: new GitReviewBudget(),
          intent: "manual-read",
          key: key("queued-shared"),
          operationId: "queued-shared-second",
          owner: ownerA,
          run: duplicateRun,
        });
      },
    });
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("queued-shared"),
      operationId: "queued-shared-first",
      owner: ownerA,
      run: sharedRun,
    });

    await expect(first.promise).resolves.toBe("shared");
    await expect(nested?.promise).resolves.toBe("shared");
    expect(sharedRun).toHaveBeenCalledOnce();
    expect(duplicateRun).not.toHaveBeenCalled();
  });

  it("running 回调附加同 key lease 只发布一次 running", async () => {
    const transitions: string[] = [];
    const sharedRun = vi.fn(async () => "shared");
    let nested: { promise: Promise<unknown> } | undefined;
    let attached = false;
    const scheduler = createGitReviewScheduler({
      onTransition(event) {
        transitions.push(`${event.operationId}:${event.state}`);
        if (
          attached ||
          event.operationId !== "running-attach-first" ||
          event.state !== "running"
        ) {
          return;
        }
        attached = true;
        nested = scheduler.schedule({
          budget: new GitReviewBudget(),
          intent: "manual-read",
          key: key("running-attach"),
          operationId: "running-attach-second",
          owner: ownerA,
          run: vi.fn(async () => "must-not-run"),
        });
      },
    });
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("running-attach"),
      operationId: "running-attach-first",
      owner: ownerA,
      run: sharedRun,
    });

    await expect(first.promise).resolves.toBe("shared");
    await expect(nested?.promise).resolves.toBe("shared");
    expect(sharedRun).toHaveBeenCalledOnce();
    expect(
      transitions.filter((entry) => entry === "running-attach-second:running")
    ).toHaveLength(1);
  });

  it("running 回调取消最后 lease 后绝不调用 run 并释放 permit", async () => {
    const run = vi.fn(async () => "must-not-run");
    const scheduler = createGitReviewScheduler({
      onTransition(event) {
        if (
          event.operationId === "running-self-cancel" &&
          event.state === "running"
        ) {
          scheduler.cancel(event.operationId);
        }
      },
    });
    const lease = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("running-self-cancel"),
      operationId: "running-self-cancel",
      owner: ownerA,
      run,
    });

    await expectSchedulerReason(lease.promise, "caller");
    await flushScheduler();
    expect(run).not.toHaveBeenCalled();
    expect(scheduler.snapshot()).toEqual({
      activeLeases: 0,
      pendingJobs: 0,
      runningJobs: 0,
    });
  });

  it("canonical observer running 回调取消最后 lease 后不调用 run", async () => {
    const events: GitReviewObservationEvent[] = [];
    const transitions: string[] = [];
    const run = vi.fn(async () => "must-not-run");
    let scheduler: ReturnType<typeof createGitReviewScheduler>;
    const observer = createGitReviewObserver({
      logger: vi.fn(),
      onEvent(event) {
        events.push(event);
        if (
          event.operationId === "observer-running-cancel" &&
          event.state === "running"
        ) {
          scheduler.cancel(event.operationId);
        }
      },
    });
    scheduler = createGitReviewScheduler({
      observer,
      onTransition(event) {
        transitions.push(event.state);
      },
    });
    const lease = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("observer-running-cancel"),
      observation: {
        queryKind: "uncommitted",
        sourceFingerprintParts: ["repo", "observer-running-cancel"],
      },
      operationId: "observer-running-cancel",
      owner: ownerA,
      run,
    });

    await expectSchedulerReason(lease.promise, "caller");
    expect(run).not.toHaveBeenCalled();
    expect(events.map((event) => event.state)).toEqual([
      "queued",
      "running",
      "cancelled",
    ]);
    expect(transitions).toEqual(["queued", "running", "cancelled"]);
    expect(observer.snapshot().active).toBe(0);
  });

  it("running job attach 的 queued transition 延后消费时仍保持单调完整", async () => {
    const transitions: string[] = [];
    const gate = createGate("done");
    let nested: { promise: Promise<unknown> } | undefined;
    let attached = false;
    const scheduler = createGitReviewScheduler({
      onTransition(event) {
        transitions.push(`${event.operationId}:${event.state}`);
        if (
          !attached &&
          event.operationId === "running-queued-first" &&
          event.state === "running"
        ) {
          attached = true;
          nested = scheduler.schedule({
            budget: new GitReviewBudget(),
            intent: "manual-read",
            key: key("running-queued-cancel"),
            operationId: "running-queued-second",
            owner: ownerA,
            run: vi.fn(async () => "must-not-run"),
          });
          return;
        }
        if (
          event.operationId === "running-queued-second" &&
          event.state === "queued"
        ) {
          scheduler.cancel(event.operationId);
        }
      },
    });
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("running-queued-cancel"),
      operationId: "running-queued-first",
      owner: ownerA,
      run: gate.run,
    });
    const nestedError = expectSchedulerReason(
      nested?.promise ?? Promise.resolve(),
      "caller"
    );

    await nestedError;
    expect(
      transitions.filter((entry) => entry.startsWith("running-queued-second:"))
    ).toEqual([
      "running-queued-second:queued",
      "running-queued-second:running",
      "running-queued-second:cancelled",
    ]);
    gate.resolve();
    await expect(first.promise).resolves.toBe("done");
  });

  it("新 job attach admission failure 也统一发布 queued/cancelled", async () => {
    const events: GitReviewObservationEvent[] = [];
    const observer = createGitReviewObserver({
      logger: vi.fn(),
      onEvent: (event) => events.push(event),
    });
    const scheduler = createGitReviewScheduler({ observer });
    const budget = new GitReviewBudget();
    vi.spyOn(budget, "consumeOutputBytes").mockReturnValueOnce("timeout");
    const lease = scheduler.schedule({
      budget,
      intent: "manual-read",
      key: key("attach-admission"),
      observation: {
        queryKind: "uncommitted",
        sourceFingerprintParts: ["repo", "attach-admission"],
      },
      operationId: "attach-admission",
      owner: ownerA,
      run: vi.fn(async () => "never"),
    });

    await expectSchedulerReason(lease.promise, "timeout");
    expect(events.map((event) => event.state)).toEqual(["queued", "cancelled"]);
    expect(observer.snapshot().active).toBe(0);
  });

  it("写任务即使 key 相同也绝不去重", async () => {
    const scheduler = createGitReviewScheduler();
    const firstGate = createGate("first");
    const secondGate = createGate("second");
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "write",
      key: key("write"),
      operationId: "write-first",
      owner: ownerA,
      run: firstGate.run,
    });
    const second = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "write",
      key: key("write"),
      operationId: "write-second",
      owner: ownerA,
      run: secondGate.run,
    });
    await flushScheduler();

    expect(firstGate.run).toHaveBeenCalledOnce();
    expect(secondGate.run).not.toHaveBeenCalled();
    firstGate.resolve();
    await first.promise;
    await flushScheduler();
    expect(secondGate.run).toHaveBeenCalledOnce();
    secondGate.resolve();
    await expect(second.promise).resolves.toBe("second");
  });

  it("单仓库 pending 达到 16 后只拒绝新请求且不逐出旧请求", async () => {
    const scheduler = createGitReviewScheduler();
    const gates = Array.from({ length: 18 }, (_, index) => createGate(index));
    const accepted = gates.slice(0, 18).map((gate, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`capacity-${index}`),
        operationId: `capacity-${index}`,
        owner: ownerA,
        run: gate.run,
      })
    );
    const rejected = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("capacity-overflow"),
      operationId: "capacity-overflow",
      owner: ownerA,
      run: vi.fn(async () => "overflow"),
    });

    await expectSchedulerReason(rejected.promise, "busy");
    expect(scheduler.snapshot()).toMatchObject({
      activeLeases: 18,
      pendingJobs: 16,
      runningJobs: 2,
    });
    for (const lease of accepted) {
      lease.cancel();
    }
    await Promise.allSettled(accepted.map((lease) => lease.promise));
    await flushScheduler();
    expect(scheduler.snapshot().activeLeases).toBe(0);
  });

  it("同 key dedupe lease 达到 128 后只拒绝新增 lease", async () => {
    const scheduler = createGitReviewScheduler();
    const gate = createGate("done");
    const leases = Array.from({ length: 128 }, (_, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key("lease-cap"),
        operationId: `lease-cap-${index}`,
        owner: ownerA,
        run: gate.run,
      })
    );
    const overflow = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("lease-cap"),
      operationId: "lease-cap-overflow",
      owner: ownerA,
      run: vi.fn(async () => "overflow"),
    });

    await expectSchedulerReason(overflow.promise, "busy");
    gate.resolve();
    await Promise.all(leases.map((lease) => lease.promise));
    expect(gate.run).toHaveBeenCalledOnce();
  });

  it("全局 pending 达到 64 后只拒绝第 65 个 job", async () => {
    const scheduler = createGitReviewScheduler();
    const runningGates = Array.from({ length: 4 }, (_, index) =>
      createGate(`global-running-${index}`)
    );
    const running = runningGates.map((gate, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`global-running-${index}`, {
          repositoryKey: index < 2 ? "global-run-a" : "global-run-b",
        }),
        operationId: `global-running-${index}`,
        owner: ownerA,
        run: gate.run,
      })
    );
    const pendingGates = Array.from({ length: 64 }, (_, index) =>
      createGate(`global-pending-${index}`)
    );
    const pending = pendingGates.map((gate, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`global-pending-${index}`, {
          repositoryKey: `global-pending-${Math.floor(index / 16)}`,
        }),
        operationId: `global-pending-${index}`,
        owner: ownerA,
        run: gate.run,
      })
    );
    const overflow = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("global-overflow", { repositoryKey: "global-overflow" }),
      operationId: "global-overflow",
      owner: ownerA,
      run: vi.fn(async () => "overflow"),
    });

    await expectSchedulerReason(overflow.promise, "busy");
    expect(scheduler.snapshot().pendingJobs).toBe(64);
    for (const lease of [...running, ...pending]) {
      lease.cancel();
    }
    await Promise.allSettled([
      ...running.map((lease) => lease.promise),
      ...pending.map((lease) => lease.promise),
    ]);
    await flushScheduler();
    expect(scheduler.snapshot().activeLeases).toBe(0);
  });

  it("settle/cancel 竞态每条路径都只产生一个 terminal", async () => {
    const transitions: string[] = [];
    const scheduler = createGitReviewScheduler({
      onTransition(event) {
        if (event.state === "cancelled" || event.state === "settled") {
          transitions.push(`${event.operationId}:${event.state}`);
        }
      },
    });
    const gate = createGate("done");
    const cancelled = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("race-cancel"),
      operationId: "race-cancel",
      owner: ownerA,
      run: gate.run,
    });
    const cancelledError = expectSchedulerReason(cancelled.promise, "caller");
    await flushScheduler();
    gate.resolve();
    cancelled.cancel();
    await cancelledError;
    await flushScheduler();

    const settled = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("race-settle"),
      operationId: "race-settle",
      owner: ownerA,
      run: async () => "done",
    });
    await settled.promise;
    expect(settled.cancel()).toBeUndefined();
    await flushScheduler();

    expect(transitions).toEqual([
      "race-cancel:cancelled",
      "race-settle:settled",
    ]);
  });

  it("持续热仓库下冷仓库最迟在两个 dispatch 周期获得许可", async () => {
    const scheduler = createGitReviewScheduler();
    const runningGates = Array.from({ length: 4 }, (_, index) =>
      createGate(`running-${index}`)
    );
    const running = runningGates.map((gate, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`running-${index}`, {
          repositoryKey: index < 2 ? "block-a" : "block-b",
        }),
        operationId: `fair-running-${index}`,
        owner: ownerA,
        run: gate.run,
      })
    );
    const order: string[] = [];
    const hotGates = [createGate("hot-1"), createGate("hot-2")];
    const hot = hotGates.map((gate, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        intent: "manual-read",
        key: key(`hot-${index}`, { repositoryKey: "hot" }),
        operationId: `fair-hot-${index}`,
        owner: ownerA,
        run: async (context) => {
          order.push(`hot-${index}`);
          return gate.run(context);
        },
      })
    );
    const coldGate = createGate("cold");
    const cold = scheduler.schedule({
      budget: new GitReviewBudget(),
      intent: "manual-read",
      key: key("cold", { repositoryKey: "cold" }),
      operationId: "fair-cold",
      owner: ownerA,
      run: async (context) => {
        order.push("cold");
        return coldGate.run(context);
      },
    });
    await flushScheduler();

    runningGates[0]?.resolve();
    await running[0]?.promise;
    await flushScheduler();
    runningGates[1]?.resolve();
    await running[1]?.promise;
    await flushScheduler();
    expect(order.slice(0, 2)).toContain("cold");

    for (const gate of [...runningGates.slice(2), ...hotGates, coldGate]) {
      gate.resolve();
    }
    await Promise.all([
      ...running.slice(2).map((lease) => lease.promise),
      ...hot.map((lease) => lease.promise),
      cold.promise,
    ]);
  });
});
