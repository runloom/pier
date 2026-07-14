import type { GitReviewBudget } from "./git-review-budget.ts";
import type {
  GitReviewCancellationReason,
  GitReviewExecutionBudget,
} from "./git-review-scheduler-contract.ts";
import type { GitReviewSharedJob } from "./git-review-scheduler-internal.ts";

/** 把共享 job 的输出、期限和逻辑文件进度同步计入每个公开请求 lease。 */
export class GitReviewSharedExecutionBudget
  implements GitReviewExecutionBudget
{
  #files = 0;
  #lastFailure: "output-limit" | "timeout" | null = null;
  #outputBytes = 0;
  readonly #job: GitReviewSharedJob;
  readonly #cancelLease: (
    operationId: string,
    reason: GitReviewCancellationReason
  ) => void;

  constructor(
    job: GitReviewSharedJob,
    cancelLease: (
      operationId: string,
      reason: GitReviewCancellationReason
    ) => void
  ) {
    this.#job = job;
    this.#cancelLease = cancelLease;
  }

  get signal(): AbortSignal {
    return this.#job.controller.signal;
  }

  admitLateLease(
    budget: GitReviewBudget
  ): "file-limit" | "ok" | "output-limit" | "timeout" {
    const outputAdmission = budget.consumeOutputBytes(this.#outputBytes);
    if (outputAdmission !== "ok") {
      return outputAdmission;
    }
    if (budget.tryConsumeFiles(this.#files)) {
      return "ok";
    }
    return budget.failureReason() ?? "file-limit";
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

  tryConsumeFiles(delta = 1): boolean {
    if (!Number.isSafeInteger(delta) || delta < 0) {
      throw new RangeError("file delta must be a non-negative safe integer");
    }
    const nextFiles = this.#files + delta;
    if (!Number.isSafeInteger(nextFiles)) {
      throw new RangeError("cumulative file count must remain a safe integer");
    }
    const leases = [...this.#job.leases.values()];
    const limited: Array<{
      operationId: string;
      reason: "file-limit" | "output-limit" | "timeout";
    }> = [];
    let admitted = 0;
    for (const lease of leases) {
      if (lease.budget.tryConsumeFiles(delta)) {
        admitted += 1;
        continue;
      }
      limited.push({
        operationId: lease.operationId,
        reason: lease.budget.failureReason() ?? "file-limit",
      });
    }
    if (admitted > 0) {
      // 先推进共享历史，再发布取消终态；观察回调若重入并附着新 lease，
      // admission 必须补扣本次已经接受的逻辑文件。
      this.#files = nextFiles;
    } else if (limited.length > 0) {
      // 全部旧 lease 耗尽时也先预留本次文件。终态回调可能同步附着一个
      // 新 lease；它会在 admission 中补扣含本次文件的完整历史。
      this.#files = nextFiles;
    }
    for (const lease of limited) {
      this.#cancelLease(lease.operationId, lease.reason);
    }
    if (this.#job.leases.size > 0) {
      return true;
    }
    // 没有 lease 接受本次文件，也没有终态回调附着新 lease；本次进度
    // 不属于共享历史，回滚预留后通知调用方停止。
    this.#files = nextFiles - delta;
    return false;
  }
}
