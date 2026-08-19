import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import type {
  GitReviewConflictPresentation,
  GitReviewConflictXy,
  GitReviewFileSection,
} from "../../../../shared/contracts/git/review.ts";
import type {
  GitReviewIndexExecutionBudget,
  GitReviewIndexGroupFact,
} from "../index/contract.ts";
import { GitReviewIndexExecutionError } from "../index/contract.ts";
import {
  GitReviewPathError,
  readGitReviewFileSnapshot,
} from "../path/guard.ts";
import {
  GitReviewDocumentProtocolError,
  GitReviewDocumentStaleError,
} from "./patch-contract.ts";

export interface ReadGitReviewConflictOptions {
  readonly budget: GitReviewIndexExecutionBudget;
  readonly fact: GitReviewIndexGroupFact;
  readonly gitRootPath: string;
  readonly signal?: AbortSignal;
}

export interface GitReviewConflictMaterial {
  readonly contents: string | null;
  readonly contentsDigest: string;
  readonly presentation: GitReviewConflictPresentation;
  readonly sourceRevision: string;
  readonly stages: {
    readonly baseOid: string | null;
    readonly oursOid: string | null;
    readonly theirsOid: string | null;
  };
  readonly xy: GitReviewConflictXy;
}

/**
 * Materialize an unmerged worktree path for review.
 * Never runs `git diff`.
 */
export async function readGitReviewConflictMaterial(
  options: ReadGitReviewConflictOptions
): Promise<GitReviewConflictMaterial> {
  if (options.fact.origin !== "conflict" || options.fact.conflict === null) {
    throw new GitReviewDocumentProtocolError(
      "conflict material 需要 origin=conflict 且带 conflict 元数据"
    );
  }
  const { conflict } = options.fact;
  const stages = {
    baseOid: conflict.baseOid,
    oursOid: conflict.oursOid,
    theirsOid: conflict.theirsOid,
  };
  const xy = conflict.xy;

  let snapshot: Awaited<ReturnType<typeof readGitReviewFileSnapshot>>;
  try {
    snapshot = await readGitReviewFileSnapshot({
      budget: options.budget,
      gitRootPath: options.gitRootPath,
      path: options.fact.targetPath,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    return materialFromPathError(error, xy, stages, options.budget);
  }

  const { bytes, digest } = snapshot;
  if (bytes.includes(0)) {
    return {
      contents: null,
      contentsDigest: digest,
      presentation: "binary",
      sourceRevision: digest,
      stages,
      xy,
    };
  }
  if (!isUtf8(bytes)) {
    return {
      contents: null,
      contentsDigest: digest,
      presentation: "invalidEncoding",
      sourceRevision: digest,
      stages,
      xy,
    };
  }

  const text = bytes.toString("utf8");
  const presentation = classifyConflictWorktreePresentation(text);
  if (presentation === "markers-text") {
    return {
      contents: text,
      contentsDigest: digest,
      presentation,
      sourceRevision: digest,
      stages,
      xy,
    };
  }

  return {
    contents: null,
    contentsDigest: digest,
    presentation: "file-level",
    sourceRevision: digest,
    stages,
    xy,
  };
}

export function sectionFromConflictMaterial(options: {
  readonly material: GitReviewConflictMaterial;
  readonly sectionKey: string;
  readonly targetPath: string;
}): Extract<GitReviewFileSection, { kind: "conflict" }> {
  return {
    contents: options.material.contents,
    contentsDigest: options.material.contentsDigest,
    kind: "conflict",
    oldPath: null,
    presentation: options.material.presentation,
    sectionKey: options.sectionKey,
    stages: options.material.stages,
    status: "conflicted",
    targetPath: options.targetPath,
    xy: options.material.xy,
  };
}

/** UnresolvedFile only parses a closed marker stack. */
export function classifyConflictWorktreePresentation(
  text: string
): "markers-text" | "file-level" {
  return hasCompleteMergeConflictMarkers(text) ? "markers-text" : "file-level";
}

/**
 * Stack-based marker validation aligned with @pierre/diffs
 * parseMergeConflictDiffFromFile (start / optional base / separator / end).
 */
export function hasCompleteMergeConflictMarkers(text: string): boolean {
  const lines = splitPreserveEmpty(text);
  const stack: Array<{ stage: "current" | "base" | "incoming" }> = [];
  let completed = 0;
  for (const line of lines) {
    const marker = mergeConflictMarkerType(line);
    const top = stack.at(-1);
    if (top === undefined) {
      if (marker === "start") {
        stack.push({ stage: "current" });
      }
      continue;
    }
    if (marker === "start") {
      stack.push({ stage: "current" });
      continue;
    }
    if (marker === "base") {
      if (top.stage !== "current") {
        return false;
      }
      top.stage = "base";
      continue;
    }
    if (marker === "separator") {
      if (top.stage !== "current" && top.stage !== "base") {
        return false;
      }
      top.stage = "incoming";
      continue;
    }
    if (marker === "end") {
      if (top.stage !== "incoming") {
        return false;
      }
      stack.pop();
      completed += 1;
    }
  }
  return stack.length === 0 && completed > 0;
}

function materialFromPathError(
  error: unknown,
  xy: GitReviewConflictXy,
  stages: GitReviewConflictMaterial["stages"],
  budget: GitReviewIndexExecutionBudget
): GitReviewConflictMaterial {
  if (!(error instanceof GitReviewPathError)) {
    throw error;
  }
  if (error.reason === "changed") {
    throw new GitReviewDocumentStaleError(error.message, { cause: error });
  }
  if (error.reason === "aborted") {
    const budgetFailure = budget.failureReason();
    if (budgetFailure !== null) {
      throw new GitReviewIndexExecutionError(
        budgetFailure,
        `Git Review conflict 文件读取 ${budgetFailure}`
      );
    }
    throw new GitReviewIndexExecutionError(
      "aborted",
      "Git Review conflict 文件读取已取消"
    );
  }

  // missing worktree (e.g. DD both deleted) is a stable file-level conflict.
  let presentation: GitReviewConflictPresentation = "readError";
  if (error.reason === "missing") {
    presentation = "file-level";
  } else if (error.reason === "tooLarge") {
    presentation = "tooLarge";
  } else if (error.reason === "symlink") {
    presentation = "file-level";
  } else if (error.reason === "notRegular") {
    presentation = "file-level";
  }

  const digest = `sha256:${createHash("sha256")
    .update(`conflict:${xy}:${error.reason}:${error.message}`)
    .digest("hex")}`;
  return {
    contents: null,
    contentsDigest: digest,
    presentation,
    sourceRevision: digest,
    stages,
    xy,
  };
}

function splitPreserveEmpty(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split(/\r?\n/u);
  if (
    (text.endsWith("\n") || text.endsWith("\r")) &&
    lines.length > 0 &&
    lines.at(-1) === ""
  ) {
    lines.pop();
  }
  return lines;
}

function mergeConflictMarkerType(
  line: string
): "start" | "base" | "separator" | "end" | null {
  if (line.startsWith("<<<<<<<")) {
    return "start";
  }
  if (line.startsWith("|||||||")) {
    return "base";
  }
  if (line.startsWith("=======")) {
    return "separator";
  }
  if (line.startsWith(">>>>>>>")) {
    return "end";
  }
  return null;
}
