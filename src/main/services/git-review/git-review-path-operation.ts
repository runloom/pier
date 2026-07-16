import type { FileHandle } from "node:fs/promises";
import type { GitExecExecutionBudget } from "../git-exec-raw-contract.ts";
import { GitReviewPathError } from "./git-review-path-contract.ts";

export function assertGitReviewPathActive(
  signal: AbortSignal | undefined
): void {
  if (signal?.aborted) {
    throw abortedPathError(signal.reason);
  }
}

export async function raceGitReviewPathOperation<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
  onLateSuccess?: (value: T) => void,
  budget?: GitExecExecutionBudget
): Promise<T> {
  assertGitReviewPathActive(signal);
  if (signal === undefined) {
    return operation();
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let pending: Promise<T> | undefined;
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    const abort = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (pending !== undefined) {
        budget?.trackDetachedOperation?.(pending);
      }
      reject(abortedPathError(signal.reason));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      pending = operation();
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
      return;
    }
    pending.then(
      (value) => {
        if (settled) {
          onLateSuccess?.(value);
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      }
    );
  });
}

export function closeGitReviewFileHandleInBackground(
  handle: FileHandle,
  budget?: GitExecExecutionBudget
): void {
  settleGitReviewPathOperationInBackground(handle.close(), budget);
}

export function settleGitReviewPathOperationInBackground(
  promise: Promise<unknown>,
  budget?: GitExecExecutionBudget
): void {
  budget?.trackDetachedOperation?.(promise);
  promise.catch(() => undefined);
}

function abortedPathError(cause: unknown): GitReviewPathError {
  return new GitReviewPathError("aborted", "Git Review 文件读取已取消", {
    cause,
  });
}
