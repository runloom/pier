import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import {
  createGitReviewScheduler,
  type GitReviewOperationOwner,
  type GitReviewRunContext,
  type GitReviewScheduleKey,
  GitReviewSchedulerError,
} from "@main/services/git-review/git-review-scheduler.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const owner: GitReviewOperationOwner = {
  clientId: "renderer",
  generation: 1,
  windowRecordId: "window-1",
};

afterEach(() => {
  vi.useRealTimers();
});

function key(sourceKey: string, repositoryKey = "repo"): GitReviewScheduleKey {
  return {
    canonicalRequestKey: sourceKey,
    operationKind: "document",
    repositoryKey,
    sourceKey,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function schedulerError(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(GitReviewSchedulerError);
  return (error as GitReviewSchedulerError).reason;
}

describe("GitReviewScheduler", () => {
  it("同一请求键共享一次执行，但每个 operation 保持独立租约", async () => {
    const scheduler = createGitReviewScheduler();
    const pending = deferred<string>();
    const run = vi.fn(() => pending.promise);
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("same"),
      operationId: "first",
      owner,
      run,
    });
    const second = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("same"),
      operationId: "second",
      owner,
      run,
    });

    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    pending.resolve("done");
    await expect(Promise.all([first.promise, second.promise])).resolves.toEqual(
      ["done", "done"]
    );
  });

  it("活动 operationId 不允许重复", async () => {
    const scheduler = createGitReviewScheduler();
    const pending = deferred<string>();
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("first"),
      operationId: "duplicate",
      owner,
      run: () => pending.promise,
    });
    const duplicate = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("second"),
      operationId: "duplicate",
      owner,
      run: async () => "unexpected",
    });

    await expect(schedulerError(duplicate.promise)).resolves.toBe(
      "duplicate-operation"
    );
    scheduler.cancelOwned("duplicate", owner);
    await expect(schedulerError(first.promise)).resolves.toBe("caller");
  });

  it("取消一个共享租约不会中断仍有消费者的执行", async () => {
    const scheduler = createGitReviewScheduler();
    const pending = deferred<string>();
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("shared"),
      operationId: "cancelled-consumer",
      owner,
      run: () => pending.promise,
    });
    const second = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("shared"),
      operationId: "remaining-consumer",
      owner,
      run: () => pending.promise,
    });

    scheduler.cancelOwned("cancelled-consumer", owner);
    await expect(schedulerError(first.promise)).resolves.toBe("caller");
    pending.resolve("kept-running");
    await expect(second.promise).resolves.toBe("kept-running");
  });

  it("cancelOwned 只能取消匹配 owner 的 operation", async () => {
    const scheduler = createGitReviewScheduler();
    const pending = deferred<string>();
    const lease = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("owned"),
      operationId: "owned-operation",
      owner,
      run: () => pending.promise,
    });

    scheduler.cancelOwned(
      "owned-operation",
      { ...owner, generation: owner.generation + 1 },
      "caller"
    );
    pending.resolve("still-running");
    await expect(lease.promise).resolves.toBe("still-running");
  });

  it("releaseOwner 只释放该导航 generation 的全部租约", async () => {
    const scheduler = createGitReviewScheduler();
    const otherOwner = { ...owner, generation: 2 };
    const oldLease = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("old"),
      operationId: "old-operation",
      owner,
      run: async () => new Promise(() => undefined),
    });
    const current = deferred<string>();
    const currentLease = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("current", "repo-2"),
      operationId: "current-operation",
      owner: otherOwner,
      run: () => current.promise,
    });

    scheduler.releaseOwner(owner);
    await expect(schedulerError(oldLease.promise)).resolves.toBe(
      "owner-disposed"
    );
    current.resolve("current");
    await expect(currentLease.promise).resolves.toBe("current");
  });

  it("取消不合作的底层 Promise 后立即归还全局运行许可", async () => {
    const scheduler = createGitReviewScheduler();
    const stubborn = Array.from({ length: 4 }, (_, index) =>
      scheduler.schedule({
        budget: new GitReviewBudget(),
        key: key(`stubborn-${index}`, `repo-${index}`),
        operationId: `stubborn-${index}`,
        owner,
        run: async () => new Promise<string>(() => undefined),
      })
    );
    const fifthStarted = vi.fn();
    const fifth = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("fifth", "repo-5"),
      operationId: "fifth",
      owner,
      run: async () => {
        fifthStarted();
        return "fifth";
      },
    });

    await Promise.resolve();
    expect(fifthStarted).not.toHaveBeenCalled();
    for (const [index, lease] of stubborn.entries()) {
      scheduler.cancelOwned(`stubborn-${index}`, owner);
      lease.promise.catch(() => undefined);
    }

    await expect(fifth.promise).resolves.toBe("fifth");
    expect(fifthStarted).toHaveBeenCalledOnce();
  });

  it("取消后的底层操作会隔离同一来源，且不阻塞其它仓库，结算后恢复排队请求", async () => {
    const scheduler = createGitReviewScheduler();
    const pending = deferred<string>();
    const run = vi.fn(() => pending.promise);
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("quarantined"),
      operationId: "quarantined-first",
      owner,
      run,
    });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    scheduler.cancelOwned("quarantined-first", owner);
    await expect(schedulerError(first.promise)).resolves.toBe("caller");

    const repeatedStarted = vi.fn();
    const repeated = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("quarantined"),
      operationId: "quarantined-repeat",
      owner,
      run: async () => {
        repeatedStarted();
        return "repeated";
      },
    });
    await Promise.resolve();
    expect(repeatedStarted).not.toHaveBeenCalled();
    const independent = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("independent", "other-repo"),
      operationId: "independent",
      owner,
      run: async () => "independent",
    });
    await expect(independent.promise).resolves.toBe("independent");
    expect(run).toHaveBeenCalledOnce();

    pending.resolve("late");
    await expect(repeated.promise).resolves.toBe("repeated");
    expect(repeatedStarted).toHaveBeenCalledOnce();
  });

  it("隔离来源的排队请求仍受自身预算约束", async () => {
    const scheduler = createGitReviewScheduler();
    const first = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: key("stalled-source"),
      operationId: "stalled-source-first",
      owner,
      run: async () => new Promise<string>(() => undefined),
    });
    await Promise.resolve();
    scheduler.cancelOwned("stalled-source-first", owner);
    await expect(schedulerError(first.promise)).resolves.toBe("caller");

    const queuedRun = vi.fn(async () => "unexpected");
    const queued = scheduler.schedule({
      budget: new GitReviewBudget({ deadlineAtMs: Date.now() + 20 }),
      key: key("stalled-source"),
      operationId: "stalled-source-queued",
      owner,
      run: queuedRun,
    });

    await expect(schedulerError(queued.promise)).resolves.toBe("timeout");
    expect(queuedRun).not.toHaveBeenCalled();
  });

  it("请求预算超时会取消租约", async () => {
    const scheduler = createGitReviewScheduler();
    const lease = scheduler.schedule({
      budget: new GitReviewBudget({ deadlineAtMs: Date.now() + 20 }),
      key: key("timeout"),
      operationId: "timeout",
      owner,
      run: async () => new Promise(() => undefined),
    });

    await expect(schedulerError(lease.promise)).resolves.toBe("timeout");
  });

  it("共享执行的输出进度会补扣到晚加入租约", async () => {
    const scheduler = createGitReviewScheduler();
    const firstConsumed = deferred<void>();
    const continueRun = deferred<void>();
    const run = async ({ budget }: GitReviewRunContext) => {
      expect(budget.consumeOutputBytes(1)).toBe("ok");
      firstConsumed.resolve();
      await continueRun.promise;
      return "done";
    };
    const first = scheduler.schedule({
      budget: new GitReviewBudget({ maxOutputBytes: 2 }),
      key: key("late"),
      operationId: "early",
      owner,
      run,
    });
    await firstConsumed.promise;
    const late = scheduler.schedule({
      budget: new GitReviewBudget({ maxOutputBytes: 1 }),
      key: key("late"),
      operationId: "late",
      owner,
      run,
    });
    continueRun.resolve();

    await expect(Promise.all([first.promise, late.promise])).resolves.toEqual([
      "done",
      "done",
    ]);
  });
});
