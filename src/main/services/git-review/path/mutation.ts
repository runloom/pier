import {
  type GitReviewFailure,
  type GitReviewIndexEntry,
  type GitReviewMutationResult,
  type GitReviewPathMutationRequest,
  gitReviewFailureSchema,
  gitReviewMutationOkSchema,
} from "../../../../shared/contracts/git/review.ts";
import type { GitReviewIndexReader } from "../index/index.ts";
import type { GitReviewMutationWriter } from "../mutation.ts";
import type { GitReviewExecutionBudget } from "../scheduler/index.ts";

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
    // 只写当前 action 相关槽的 target/old，避免把已消失的历史 oldPath
    // 塞进 git add（目录整理 rename 后旧路径 pathspec 128）。
    for (const candidate of writerPathsForEntry(entry, request.action)) {
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

/**
 * 为 writer 收集 pathspec：
 * - 始终包含 entry.path（当前显示路径）
 * - 仅当对应分组槽仍声明 oldPath（rename）时附带 oldPath
 */
function writerPathsForEntry(
  entry: GitReviewIndexEntry,
  action: GitReviewPathMutationRequest["action"]
): readonly string[] {
  const paths = new Set<string>([entry.path]);
  for (const slot of entry.renderSlots) {
    if (slot.oldPath === null) {
      continue;
    }
    if (action === "stage") {
      if (slot.group === "unstaged" || slot.group === "conflict") {
        paths.add(slot.oldPath);
      }
      continue;
    }
    if (action === "unstage") {
      if (slot.group === "staged") {
        paths.add(slot.oldPath);
      }
      continue;
    }
    // revert：只动 unstaged
    if (slot.group === "unstaged") {
      paths.add(slot.oldPath);
    }
  }
  return [...paths];
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
