import { GIT_EXEC_MAX_TIMEOUT_MS } from "../git-exec.ts";
import {
  GitReviewIdentityError,
  type GitReviewIdentityExecutionOptions,
} from "./git-review-identity-contract.ts";

export function assertGitReviewIdentityExecutionOptions(
  options: GitReviewIdentityExecutionOptions,
  nowMs = Date.now()
): void {
  if (!Number.isSafeInteger(nowMs)) {
    throw configurationError("当前时间必须是安全整数时间戳");
  }
  if (
    options.timeoutMs !== undefined &&
    !(
      Number.isSafeInteger(options.timeoutMs) &&
      options.timeoutMs > 0 &&
      options.timeoutMs <= GIT_EXEC_MAX_TIMEOUT_MS
    )
  ) {
    throw configurationError(
      `timeoutMs 必须是 1..${GIT_EXEC_MAX_TIMEOUT_MS} 的安全整数`
    );
  }
  if (
    options.deadlineAtMs !== undefined &&
    !Number.isSafeInteger(options.deadlineAtMs)
  ) {
    throw configurationError("deadlineAtMs 必须是安全整数时间戳");
  }
  if (
    options.deadlineAtMs !== undefined &&
    options.deadlineAtMs - nowMs > GIT_EXEC_MAX_TIMEOUT_MS
  ) {
    throw configurationError(
      `deadlineAtMs 距当前时间不得超过 ${GIT_EXEC_MAX_TIMEOUT_MS}ms`
    );
  }
}

export async function raceGitReviewIdentityBoundary<T>(
  operation: () => Promise<T>,
  options: GitReviewIdentityExecutionOptions
): Promise<T> {
  const startedAtMs = Date.now();
  assertGitReviewIdentityExecutionOptions(options, startedAtMs);
  const signals = uniqueSignals(options);
  const localDeadlineAt = Math.min(
    options.deadlineAtMs ?? Number.POSITIVE_INFINITY,
    options.timeoutMs === undefined
      ? Number.POSITIVE_INFINITY
      : startedAtMs + options.timeoutMs
  );
  const initialFailure = identityBoundaryFailure(
    options,
    signals,
    localDeadlineAt
  );
  if (initialFailure !== null) {
    throw initialFailure;
  }
  return new Promise<T>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    let operationSettled = false;
    let pendingOperation: Promise<T> | undefined;
    const cleanup = (): void => {
      for (const signal of signals) {
        signal.removeEventListener("abort", abort);
      }
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
    const settleReject = (error: unknown): void => {
      if (settled) {
        return;
      }
      if (!operationSettled && pendingOperation !== undefined) {
        if (options.trackDetachedOperation === undefined) {
          options.budget?.trackDetachedOperation?.(pendingOperation);
        } else {
          options.trackDetachedOperation(pendingOperation);
        }
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = (): void => {
      settleReject(
        identityBoundaryFailure(options, signals, localDeadlineAt) ??
          new GitReviewIdentityError("aborted", "仓库路径解析已取消")
      );
    };
    for (const signal of signals) {
      signal.addEventListener("abort", abort, { once: true });
    }
    const failureAfterListening = identityBoundaryFailure(
      options,
      signals,
      localDeadlineAt
    );
    if (failureAfterListening !== null) {
      settleReject(failureAfterListening);
      return;
    }
    try {
      pendingOperation = operation();
    } catch (error) {
      settleReject(error);
      return;
    }
    const scheduleTimeout = (): void => {
      if (settled) {
        return;
      }
      const failure = identityBoundaryFailure(
        options,
        signals,
        localDeadlineAt
      );
      if (failure !== null) {
        settleReject(failure);
        return;
      }
      const remainingMs = Math.min(
        localDeadlineAt - Date.now(),
        options.budget?.remainingTimeMs() ?? Number.POSITIVE_INFINITY
      );
      if (!Number.isFinite(remainingMs)) {
        return;
      }
      timer = setTimeout(
        () => {
          timer = undefined;
          scheduleTimeout();
        },
        Math.min(GIT_EXEC_MAX_TIMEOUT_MS, Math.max(1, remainingMs))
      );
      timer.unref?.();
    };
    scheduleTimeout();
    pendingOperation.then(
      (value) => {
        operationSettled = true;
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        operationSettled = true;
        settleReject(error);
      }
    );
  });
}

function configurationError(message: string): GitReviewIdentityError {
  return new GitReviewIdentityError("configuration", message);
}

function identityBoundaryFailure(
  options: GitReviewIdentityExecutionOptions,
  signals: readonly AbortSignal[],
  localDeadlineAt: number
): GitReviewIdentityError | null {
  const budgetReason = options.budget?.failureReason();
  if (budgetReason === "output-limit") {
    return new GitReviewIdentityError(
      "outputLimit",
      "仓库路径解析输出预算已耗尽"
    );
  }
  if (budgetReason === "timeout") {
    return new GitReviewIdentityError("timeout", "仓库路径解析期限已到");
  }
  for (const signal of signals) {
    if (!signal.aborted) {
      continue;
    }
    if (signal.reason === "output-limit") {
      return new GitReviewIdentityError(
        "outputLimit",
        "仓库路径解析输出预算已耗尽"
      );
    }
    if (signal.reason === "timeout") {
      return new GitReviewIdentityError("timeout", "仓库路径解析期限已到");
    }
    return new GitReviewIdentityError("aborted", "仓库路径解析已取消");
  }
  if (localDeadlineAt <= Date.now()) {
    return new GitReviewIdentityError("timeout", "仓库路径解析期限已到");
  }
  return null;
}

function uniqueSignals(
  options: GitReviewIdentityExecutionOptions
): readonly AbortSignal[] {
  return [
    ...new Set(
      [options.signal, options.budget?.signal].filter(
        (signal): signal is AbortSignal => signal !== undefined
      )
    ),
  ];
}
