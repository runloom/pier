import {
  GIT_REVIEW_DEADLINE_MS,
  GIT_REVIEW_MAX_OUTPUT_BYTES,
  GitReviewBudget,
} from "@main/services/git-review/git-review-budget.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

describe("GitReviewBudget", () => {
  it("默认从创建时起提供 15 秒总期限", () => {
    let now = 1000;
    const readNow = vi.fn(() => now);
    const budget = new GitReviewBudget({ now: readNow });

    expect(budget.deadlineAtMs).toBe(1000 + GIT_REVIEW_DEADLINE_MS);
    expect(readNow).toHaveBeenCalledOnce();
    now += 1234;
    expect(budget.remainingTimeMs()).toBe(GIT_REVIEW_DEADLINE_MS - 1234);
    budget.dispose();
  });

  it("多个子命令同步累计输出且允许精确边界", () => {
    const budget = new GitReviewBudget();

    expect(budget.consumeOutputBytes(GIT_REVIEW_MAX_OUTPUT_BYTES - 1)).toBe(
      "ok"
    );
    expect(budget.consumeOutputBytes(1)).toBe("ok");
    expect(budget.consumeOutputBytes(1)).toBe("output-limit");
    expect(budget.signal.aborted).toBe(true);
    expect(budget.failureReason()).toBe("output-limit");
  });

  it("累计输出超出安全整数时饱和到 MAX_SAFE 并稳定终止", () => {
    const budget = new GitReviewBudget();

    expect(budget.consumeOutputBytes(1)).toBe("ok");
    expect(budget.consumeOutputBytes(Number.MAX_SAFE_INTEGER)).toBe(
      "output-limit"
    );
    expect(budget.failureReason()).toBe("output-limit");
    expect(budget.consumeOutputBytes(0)).toBe("output-limit");
  });

  it("期限包含排队时间且到点同步冻结为 timeout", () => {
    let now = 50;
    const budget = new GitReviewBudget({
      deadlineAtMs: 100,
      now: () => now,
    });

    now = 100;
    expect(budget.remainingTimeMs()).toBe(0);
    expect(budget.failureReason()).toBe("timeout");
    expect(budget.signal.reason).toBe("timeout");
  });

  it("计时器到期会主动取消仍在运行的子命令", async () => {
    vi.useFakeTimers();
    const budget = new GitReviewBudget({ deadlineAtMs: Date.now() + 25 });
    const abort = vi.fn();
    budget.signal.addEventListener("abort", abort);

    await vi.advanceTimersByTimeAsync(25);

    expect(abort).toHaveBeenCalledOnce();
    expect(budget.failureReason()).toBe("timeout");
  });

  it("首个致命原因稳定且后续扣减不能改写", () => {
    let now = 0;
    const budget = new GitReviewBudget({
      deadlineAtMs: 10,
      maxOutputBytes: 1,
      now: () => now,
    });

    expect(budget.consumeOutputBytes(2)).toBe("output-limit");
    now = 10;
    expect(budget.failureReason()).toBe("output-limit");
    expect(budget.consumeOutputBytes(0)).toBe("output-limit");
  });

  it("拒绝会破坏计数不变量的参数", () => {
    expect(
      () =>
        new GitReviewBudget({
          maxOutputBytes: GIT_REVIEW_MAX_OUTPUT_BYTES + 1,
        })
    ).toThrow(RangeError);
    expect(
      () => new GitReviewBudget({ maxOutputBytes: Number.MAX_SAFE_INTEGER })
    ).toThrow(RangeError);
    const budget = new GitReviewBudget();
    expect(() => budget.consumeOutputBytes(-1)).toThrow(RangeError);
    budget.dispose();
    expect(
      () => new GitReviewBudget({ deadlineAtMs: Number.POSITIVE_INFINITY })
    ).toThrow(RangeError);
    expect(() => new GitReviewBudget({ deadlineAtMs: Number.NaN })).toThrow(
      RangeError
    );
    expect(
      () =>
        new GitReviewBudget({
          deadlineAtMs: 1000 + GIT_REVIEW_DEADLINE_MS + 1,
          now: () => 1000,
        })
    ).toThrow(RangeError);
    expect(
      () => new GitReviewBudget({ deadlineAtMs: Number.MAX_SAFE_INTEGER })
    ).toThrow(RangeError);
    expect(() => new GitReviewBudget({ now: () => Number.NaN })).toThrow(
      RangeError
    );
  });
});
