import type { GitReviewBudget } from "./git-review-budget.ts";
import type {
  GitReviewCancellationReason,
  GitReviewExecutionBudget,
} from "./git-review-scheduler-contract.ts";
import type { GitReviewSharedJob } from "./git-review-scheduler-internal.ts";

/** 把共享 job 的输出与期限进度同步计入每个公开请求 lease。 */
export class GitReviewSharedExecutionBudget
  implements GitReviewExecutionBudget
{
  #lastFailure: "output-limit" | "timeout" | null = null;
  #outputBytes = 0;
  readonly #job: GitReviewSharedJob;
  readonly #cancelLease: (
    operationId: string,
    reason: GitReviewCancellationReason
  ) => void;
  readonly #trackDetachedOperation: (operation: Promise<unknown>) => void;

  constructor(
    job: GitReviewSharedJob,
    cancelLease: (
      operationId: string,
      reason: GitReviewCancellationReason
    ) => void,
    trackDetachedOperation: (operation: Promise<unknown>) => void
  ) {
    this.#job = job;
    this.#cancelLease = cancelLease;
    this.#trackDetachedOperation = trackDetachedOperation;
  }

  get signal(): AbortSignal {
    return this.#job.controller.signal;
  }

  admitLateLease(budget: GitReviewBudget): "ok" | "output-limit" | "timeout" {
    return budget.consumeOutputBytes(this.#outputBytes);
  }

  consumeOutputBytes(delta: number): "ok" | "output-limit" | "timeout" {
    if (!Number.isSafeInteger(delta) || delta < 0) {
      throw new RangeError(
        "output byte delta must be a non-negative safe integer"
      );
    }
    const nextOutputBytes = this.#outputBytes + delta;
    if (!Number.isSafeInteger(nextOutputBytes)) {
      this.#outputBytes = Number.MAX_SAFE_INTEGER;
      this.noteFailure("output-limit");
      for (const lease of [...this.#job.leases.values()]) {
        this.#cancelLease(lease.operationId, "output-limit");
      }
      return "output-limit";
    }
    this.#outputBytes = nextOutputBytes;
    for (const lease of [...this.#job.leases.values()]) {
      const decision = lease.budget.consumeOutputBytes(delta);
      if (decision !== "ok") {
        this.#cancelLease(lease.operationId, decision);
      }
    }
    if (this.#job.leases.size > 0) {
      return "ok";
    }
    return this.#lastFailure ?? "timeout";
  }

  failureReason(): "output-limit" | "timeout" | null {
    return this.#lastFailure;
  }

  noteFailure(reason: "output-limit" | "timeout"): void {
    this.#lastFailure ??= reason;
  }

  remainingTimeMs(): number {
    let remaining = 0;
    for (const lease of this.#job.leases.values()) {
      remaining = Math.max(remaining, lease.budget.remainingTimeMs());
    }
    return remaining;
  }

  trackDetachedOperation(operation: Promise<unknown>): void {
    this.#trackDetachedOperation(operation);
  }
}
