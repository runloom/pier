import { createHash } from "node:crypto";
import { createGitReviewPatchState } from "./git-review-document-envelope.ts";
import {
  GitReviewDocumentStaleError,
  type GitReviewPatchMaterial,
  type ReadGitReviewPatchOptions,
} from "./git-review-document-patch-contract.ts";
import { raceGitReviewIdentityBoundary } from "./git-review-identity-boundary.ts";
import { GitReviewIndexExecutionError } from "./git-review-index-contract.ts";
import {
  type GitReviewFileFingerprint,
  type GitReviewFileSnapshot,
  GitReviewPathError,
  readGitReviewFileFingerprint,
  readGitReviewFileSnapshot,
} from "./git-review-path-guard.ts";

export function raceFilesystemOperation<T>(
  options: ReadGitReviewPatchOptions,
  operation: () => Promise<T>
): Promise<T> {
  return raceGitReviewIdentityBoundary(operation, {
    budget: options.budget,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

export async function tryReadSnapshot(
  options: ReadGitReviewPatchOptions
): Promise<
  | { readonly kind: "snapshot"; readonly snapshot: GitReviewFileSnapshot }
  | Extract<GitReviewPatchMaterial, { kind: "state" }>
> {
  try {
    return {
      kind: "snapshot",
      snapshot: await readGitReviewFileSnapshot({
        budget: options.budget,
        gitRootPath: options.gitRootPath,
        path: options.fact.targetPath,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    };
  } catch (error) {
    return pathErrorToSnapshotResult(error, options);
  }
}

export async function tryReadFingerprint(
  options: ReadGitReviewPatchOptions
): Promise<
  | { readonly kind: "snapshot"; readonly snapshot: GitReviewFileFingerprint }
  | Extract<GitReviewPatchMaterial, { kind: "state" }>
> {
  try {
    return {
      kind: "snapshot",
      snapshot: await readGitReviewFileFingerprint({
        budget: options.budget,
        gitRootPath: options.gitRootPath,
        path: options.fact.targetPath,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    };
  } catch (error) {
    return pathErrorToSnapshotResult(error, options);
  }
}

function pathErrorToSnapshotResult(
  error: unknown,
  options: ReadGitReviewPatchOptions
): Extract<GitReviewPatchMaterial, { kind: "state" }> {
  if (!(error instanceof GitReviewPathError)) {
    throw error;
  }
  if (error.reason === "changed" || error.reason === "missing") {
    throw new GitReviewDocumentStaleError(error.message, { cause: error });
  }
  if (error.reason === "aborted") {
    const budgetFailure = options.budget.failureReason();
    if (budgetFailure !== null) {
      throw new GitReviewIndexExecutionError(
        budgetFailure,
        `Git Review 文件读取 ${budgetFailure}`
      );
    }
    throw new GitReviewIndexExecutionError(
      "aborted",
      "Git Review 文件读取已取消"
    );
  }
  let reason: "readError" | "symlink" | "tooLarge" = "readError";
  if (error.reason === "symlink") {
    reason = "symlink";
  } else if (error.reason === "tooLarge") {
    reason = "tooLarge";
  }
  return createGitReviewPatchState(
    reason,
    createHash("sha256").update(error.message).digest("hex")
  );
}
