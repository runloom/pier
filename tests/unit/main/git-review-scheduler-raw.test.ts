import { EventEmitter } from "node:events";
import { createExecGitRaw, GitExecRawError } from "@main/services/git-exec.ts";
import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import {
  createGitReviewScheduler,
  type GitReviewRunContext,
  GitReviewSchedulerError,
} from "@main/services/git-review/git-review-scheduler.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeReadable extends EventEmitter {
  destroy(): void {
    // raw watchdog seam
  }
}

class FakeWritable extends EventEmitter {
  destroy(): void {
    // raw cancellation seam
  }
  end(): void {
    // raw stdin seam
  }
}

class FakeChild extends EventEmitter {
  readonly killed: NodeJS.Signals[] = [];
  readonly stderr = new FakeReadable();
  readonly stdin = new FakeWritable();
  readonly stdout = new FakeReadable();

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed.push(signal);
    return true;
  }
}

const owner = { clientId: "renderer", generation: 1, windowRecordId: "w1" };
const scheduleKey = {
  canonicalRequestKey: "request",
  operationKind: "document" as const,
  repositoryKey: "repo",
  sourceKey: "source",
};
const MEBIBYTE = 1024 * 1024;

afterEach(() => {
  vi.useRealTimers();
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("GitReviewScheduler → raw budget integration", () => {
  it("晚加入 lease 可延长共享 raw deadline，首 lease 独立超时", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const spawn = vi.fn(
      () => child
    ) as unknown as typeof import("node:child_process").spawn;
    const raw = createExecGitRaw({ spawn });
    const scheduler = createGitReviewScheduler();
    const run = ({ budget, signal }: GitReviewRunContext) =>
      raw(["status"], {
        budget,
        cwd: "/repo",
        mode: "collect",
        signal,
      });
    const first = scheduler.schedule({
      budget: new GitReviewBudget({ deadlineAtMs: Date.now() + 50 }),
      key: scheduleKey,
      operationId: "first",
      owner,
      run,
    });
    const firstError = first.promise.catch((error: unknown) => error);
    await flush();
    await vi.advanceTimersByTimeAsync(10);

    const second = scheduler.schedule({
      budget: new GitReviewBudget({ deadlineAtMs: Date.now() + 500 }),
      key: scheduleKey,
      operationId: "second",
      owner,
      run,
    });
    await vi.advanceTimersByTimeAsync(50);

    const error = await firstError;
    expect(error).toBeInstanceOf(GitReviewSchedulerError);
    expect((error as GitReviewSchedulerError).reason).toBe("timeout");
    expect(child.killed).toEqual([]);

    child.stdout.emit("data", Buffer.from("ok"));
    child.emit("close", 0);
    await expect(second.promise).resolves.toMatchObject({
      kind: "collected",
      stdout: Buffer.from("ok"),
    });
  });

  it("共享 signal 不会把 output-limit 降级为 aborted", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(
      () => child
    ) as unknown as typeof import("node:child_process").spawn;
    const raw = createExecGitRaw({ spawn });
    const scheduler = createGitReviewScheduler();
    let rawError: unknown;
    const lease = scheduler.schedule({
      budget: new GitReviewBudget({ maxOutputBytes: 1 }),
      key: scheduleKey,
      operationId: "output-limit",
      owner,
      run: async ({ budget, signal }) => {
        try {
          return await raw(["status"], {
            budget,
            cwd: "/repo",
            mode: "collect",
            signal,
          });
        } catch (error) {
          rawError = error;
          throw error;
        }
      },
    });
    const leaseError = lease.promise.catch((error: unknown) => error);
    await flush();
    child.stdout.emit("data", Buffer.from("xx"));
    child.emit("close", null);
    await flush();

    const schedulerError = await leaseError;
    expect((schedulerError as GitReviewSchedulerError).reason).toBe(
      "output-limit"
    );
    expect(rawError).toBeInstanceOf(GitExecRawError);
    expect((rawError as GitExecRawError).causeKind).toBe("output-limit");
  });

  it("共享预算下单条 raw 命令可超过文本执行器的 16 MiB 默认值", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(
      () => child
    ) as unknown as typeof import("node:child_process").spawn;
    const raw = createExecGitRaw({ spawn });
    const scheduler = createGitReviewScheduler();
    const lease = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: scheduleKey,
      operationId: "budgeted-command-over-16-mib",
      owner,
      run: ({ budget, signal }) =>
        raw(["status"], {
          budget,
          cwd: "/repo",
          mode: "collect",
          signal,
        }),
    });
    await flush();
    const chunk = Buffer.alloc(MEBIBYTE, 120);
    for (let index = 0; index < 17; index += 1) {
      child.stderr.emit("data", chunk);
    }
    child.emit("close", 0);

    await expect(lease.promise).resolves.toMatchObject({
      kind: "collected",
      stderrBytes: 17 * MEBIBYTE,
    });
  });

  it("多条 raw 子命令共享累计 64 MiB 输出预算", async () => {
    const firstChild = new FakeChild();
    const secondChild = new FakeChild();
    const children = [firstChild, secondChild];
    const spawn = vi.fn(() => {
      const child = children.shift();
      if (child === undefined) {
        throw new Error("missing fake child");
      }
      return child;
    }) as unknown as typeof import("node:child_process").spawn;
    const raw = createExecGitRaw({ spawn });
    const scheduler = createGitReviewScheduler();
    let rawError: unknown;
    const lease = scheduler.schedule({
      budget: new GitReviewBudget(),
      key: scheduleKey,
      operationId: "aggregate-output-limit",
      owner,
      run: async ({ budget, signal }) => {
        try {
          await raw(["first"], {
            budget,
            cwd: "/repo",
            mode: "collect",
            signal,
          });
          return await raw(["second"], {
            budget,
            cwd: "/repo",
            mode: "collect",
            signal,
          });
        } catch (error) {
          rawError = error;
          throw error;
        }
      },
    });
    const leaseError = lease.promise.catch((error: unknown) => error);
    await flush();
    const chunk = Buffer.alloc(MEBIBYTE, 120);
    for (let index = 0; index < 32; index += 1) {
      firstChild.stderr.emit("data", chunk);
    }
    firstChild.emit("close", 0);
    await flush();
    expect(spawn).toHaveBeenCalledTimes(2);

    for (let index = 0; index < 32; index += 1) {
      secondChild.stderr.emit("data", chunk);
    }
    secondChild.stderr.emit("data", Buffer.of(120));
    secondChild.emit("close", null);
    await flush();

    const schedulerError = await leaseError;
    expect(schedulerError).toBeInstanceOf(GitReviewSchedulerError);
    expect((schedulerError as GitReviewSchedulerError).reason).toBe(
      "output-limit"
    );
    expect(rawError).toBeInstanceOf(GitExecRawError);
    expect((rawError as GitExecRawError).causeKind).toBe("output-limit");
  });
});
