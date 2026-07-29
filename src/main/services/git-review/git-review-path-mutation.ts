import {
  type GitReviewFailure,
  type GitReviewIndexEntry,
  type GitReviewMutationResult,
  type GitReviewPathMutationRequest,
  gitReviewFailureSchema,
  gitReviewMutationOkSchema,
} from "../../../shared/contracts/git-review.ts";
import type { GitReviewIndexReader } from "./git-review-index.ts";
import type { GitReviewMutationWriter } from "./git-review-mutation.ts";
import type { GitReviewExecutionBudget } from "./git-review-scheduler.ts";

type PathMutationIndexReader = Pick<GitReviewIndexReader, "read">;

/**
 * 目录树路径集合写入：先在同一 index 快照上完成全部校验，再且仅再调用一次 writer。
 */
export async function applyGitReviewPathMutation(options: {
  readonly budget: GitReviewExecutionBudget;
  readonly indexReader: PathMutationIndexReader;
  readonly request: GitReviewPathMutationRequest;
  readonly signal: AbortSignal;
  readonly writer: GitReviewMutationWriter;
}): Promise<GitReviewMutationResult> {
  const { budget, indexReader, request, signal, writer } = options;
  const current = await indexReader.read(
    { scope: request.source },
    { budget, signal }
  );
  if (current.kind === "error") {
    return current;
  }
  if (current.indexRevision !== request.expectedIndexRevision) {
    return failure(
      "staleRevision",
      true,
      "The changed-file list was updated before the operation ran"
    );
  }

  const writerPaths: string[] = [];
  const seenWriterPaths = new Set<string>();
  for (const path of request.paths) {
    const entry = findEligibleEntry(current.entries, path, request.action);
    if (entry === undefined) {
      return failure(
        "changeNotFound",
        true,
        "One or more selected Git changes no longer exist"
      );
    }
    for (const candidate of [entry.path, ...entry.oldPaths]) {
      if (!seenWriterPaths.has(candidate)) {
        seenWriterPaths.add(candidate);
        writerPaths.push(candidate);
      }
    }
  }

  if (request.action === "stage") {
    await writer.stage(request.source.gitRootPath, { paths: writerPaths });
  } else if (request.action === "unstage") {
    await writer.unstage(request.source.gitRootPath, { paths: writerPaths });
  } else {
    await writer.discardChanges(request.source.gitRootPath, {
      paths: writerPaths,
    });
  }
  return gitReviewMutationOkSchema.parse({
    kind: "ok",
    operationId: request.operationId,
  });
}

function findEligibleEntry(
  entries: readonly GitReviewIndexEntry[],
  path: string,
  action: GitReviewPathMutationRequest["action"]
): GitReviewIndexEntry | undefined {
  return entries.find((entry) => {
    if (entry.path !== path && !entry.oldPaths.includes(path)) {
      return false;
    }
    if (action === "stage") {
      return entry.renderSlots.some(
        (slot) => slot.group === "unstaged" || slot.group === "conflict"
      );
    }
    if (action === "unstage") {
      return entry.renderSlots.some((slot) => slot.group === "staged");
    }
    return entry.renderSlots.some(
      (slot) =>
        slot.group === "unstaged" &&
        (slot.status === "added" ||
          slot.status === "deleted" ||
          slot.status === "modified")
    );
  });
}

function failure(
  reason: GitReviewFailure["reason"],
  retryable: boolean,
  message: string
): GitReviewFailure {
  return gitReviewFailureSchema.parse({
    kind: "error",
    message,
    reason,
    retryable,
  });
}
