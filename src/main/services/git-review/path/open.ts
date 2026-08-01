import type { FileHandle } from "node:fs/promises";
import type { GitExecExecutionBudget } from "../../git/exec-raw-contract.ts";
import {
  GitSafePathOpenError,
  openGitPathNoSymlinks,
} from "../../git/safe-path-open.ts";
import { GitReviewPathError } from "./contract.ts";

interface OpenGitReviewFileOptions {
  readonly budget?: GitExecExecutionBudget;
  readonly canonicalRoot: string;
  readonly segments: readonly string[];
  readonly signal?: AbortSignal;
  readonly target: string;
}

/** Git Review 兼容门面；通用安全 open 位于 ../git-safe-path-open.ts。 */
export async function openGitReviewFileNoSymlinks(
  options: OpenGitReviewFileOptions
): Promise<FileHandle> {
  try {
    return await openGitPathNoSymlinks({
      canonicalRoot: options.canonicalRoot,
      onDetachedOperation: (operation) =>
        options.budget?.trackDetachedOperation?.(operation),
      segments: options.segments,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      target: options.target,
    });
  } catch (error) {
    if (error instanceof GitSafePathOpenError) {
      throw new GitReviewPathError(
        error.reason === "aborted" ? "aborted" : "readFailed",
        error.message,
        { cause: error }
      );
    }
    throw error;
  }
}
