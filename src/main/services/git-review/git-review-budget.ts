import type { GitExecExecutionBudget } from "../git-exec-raw-contract.ts";

export const GIT_REVIEW_DEADLINE_MS = 15_000;
export const GIT_REVIEW_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

type GitReviewFatalBudgetReason = "output-limit" | "timeout";

export interface CreateGitReviewBudgetOptions {
  deadlineAtMs?: number;
  maxOutputBytes?: number;
  now?: () => number;
}

/**
 * 一次公开 Git Review 请求唯一持有的聚合预算。
 * 所有子命令共享该对象，因而 deadline 与输出字节不会按命令重置。
 */
export class GitReviewBudget implements GitExecExecutionBudget {
  readonly #controller = new AbortController();
  readonly #deadlineAtMs: number;
  readonly #maxOutputBytes: number;
  readonly #now: () => number;
  #outputBytes = 0;
  #reason: GitReviewFatalBudgetReason | null = null;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: CreateGitReviewBudgetOptions = {}) {
    this.#now = options.now ?? Date.now;
    const createdAtMs = this.#now();
    if (!Number.isSafeInteger(createdAtMs)) {
      throw new RangeError("now() must return a safe integer timestamp");
    }
    this.#deadlineAtMs =
      options.deadlineAtMs ?? createdAtMs + GIT_REVIEW_DEADLINE_MS;
    this.#maxOutputBytes =
      options.maxOutputBytes ?? GIT_REVIEW_MAX_OUTPUT_BYTES;
    assertPositiveSafeInteger(this.#maxOutputBytes, "maxOutputBytes");
    if (this.#maxOutputBytes > GIT_REVIEW_MAX_OUTPUT_BYTES) {
      throw new RangeError(
        `maxOutputBytes must not exceed ${GIT_REVIEW_MAX_OUTPUT_BYTES}`
      );
    }
    if (!Number.isSafeInteger(this.#deadlineAtMs)) {
      throw new RangeError("deadlineAtMs must be a safe integer timestamp");
    }
    if (this.#deadlineAtMs > createdAtMs + GIT_REVIEW_DEADLINE_MS) {
      throw new RangeError(
        `deadlineAtMs must not exceed creation time + ${GIT_REVIEW_DEADLINE_MS}`
      );
    }

    const delayMs = this.#deadlineAtMs - createdAtMs;
    if (delayMs <= 0) {
      this.#fail("timeout");
      return;
    }
    this.#timer = setTimeout(() => {
      this.#fail("timeout");
    }, delayMs);
    this.#timer.unref?.();
  }

  get deadlineAtMs(): number {
    return this.#deadlineAtMs;
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  consumeOutputBytes(delta: number): "ok" | GitReviewFatalBudgetReason {
    assertNonNegativeSafeInteger(delta, "output byte delta");
    const currentFailure = this.#refreshTimeout();
    if (currentFailure !== null) {
      return currentFailure;
    }
    const nextOutputBytes = this.#outputBytes + delta;
    if (!Number.isSafeInteger(nextOutputBytes)) {
      this.#outputBytes = Number.MAX_SAFE_INTEGER;
      this.#fail("output-limit");
      return "output-limit";
    }
    this.#outputBytes = nextOutputBytes;
    if (this.#outputBytes > this.#maxOutputBytes) {
      this.#fail("output-limit");
      return "output-limit";
    }
    return "ok";
  }

  dispose(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }

  failureReason(): GitReviewFatalBudgetReason | null {
    return this.#refreshTimeout();
  }

  remainingTimeMs(): number {
    if (this.#refreshTimeout() !== null) {
      return 0;
    }
    return Math.max(0, this.#deadlineAtMs - this.#now());
  }

  #fail(reason: GitReviewFatalBudgetReason): void {
    if (this.#reason !== null) {
      return;
    }
    this.#reason = reason;
    this.dispose();
    this.#controller.abort(reason);
  }

  #refreshTimeout(): GitReviewFatalBudgetReason | null {
    if (this.#reason === null && this.#now() >= this.#deadlineAtMs) {
      this.#fail("timeout");
    }
    return this.#reason;
  }
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!(Number.isSafeInteger(value) && value >= 0)) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!(Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}
