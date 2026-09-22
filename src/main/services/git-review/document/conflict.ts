import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import type {
  GitReviewConflictPresentation,
  GitReviewConflictXy,
  GitReviewFileSection,
} from "../../../../shared/contracts/git/review.ts";
import type { ExecGitRaw } from "../../git/exec.ts";
import type {
  GitReviewIndexExecutionBudget,
  GitReviewIndexGroupFact,
} from "../index/contract.ts";
import { GitReviewIndexExecutionError } from "../index/contract.ts";
import {
  GIT_REVIEW_SNAPSHOT_MAX_BYTES,
  GitReviewPathError,
  readGitReviewFileSnapshot,
} from "../path/guard.ts";
import {
  GitReviewDocumentProtocolError,
  GitReviewDocumentStaleError,
} from "./patch-contract.ts";

export interface ReadGitReviewConflictOptions {
  readonly budget: GitReviewIndexExecutionBudget;
  readonly execGitRaw: ExecGitRaw;
  readonly fact: GitReviewIndexGroupFact;
  readonly gitRootPath: string;
  readonly signal?: AbortSignal;
}

export interface GitReviewConflictMaterial {
  readonly contents: string | null;
  readonly contentsDigest: string;
  readonly oursContents?: string | null;
  readonly presentation: GitReviewConflictPresentation;
  readonly sourceRevision: string;
  readonly stages: {
    readonly baseOid: string | null;
    readonly oursOid: string | null;
    readonly theirsOid: string | null;
  };
  readonly theirsContents?: string | null;
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
    return materialFromPathError(error, xy, stages, options);
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

  // Worktree text is the body. Stage blobs are only for a missing file.
  return {
    contents: text,
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
    ...(options.material.oursContents === undefined
      ? {}
      : { oursContents: options.material.oursContents }),
    ...(options.material.theirsContents === undefined
      ? {}
      : { theirsContents: options.material.theirsContents }),
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

async function materialFromPathError(
  error: unknown,
  xy: GitReviewConflictXy,
  stages: GitReviewConflictMaterial["stages"],
  options: ReadGitReviewConflictOptions
): Promise<GitReviewConflictMaterial> {
  const { budget } = options;
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
  const base = {
    contents: null,
    contentsDigest: digest,
    presentation,
    sourceRevision: digest,
    stages,
    xy,
  };
  if (presentation !== "file-level") {
    return base;
  }
  const sides = await readConflictStageTexts(options, stages);
  if (sides === null) {
    return base;
  }
  return {
    ...base,
    oursContents: sides.oursContents,
    sourceRevision: `${digest}:sides:${sides.digest}`,
    theirsContents: sides.theirsContents,
  };
}

type ConflictStageBlob =
  | { readonly contents: string; readonly kind: "text" }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable" };

async function readConflictStageTexts(
  options: ReadGitReviewConflictOptions,
  stages: GitReviewConflictMaterial["stages"]
): Promise<{
  readonly digest: string;
  readonly oursContents: string | null;
  readonly theirsContents: string | null;
} | null> {
  const [ours, theirs] = await Promise.all([
    readConflictBlob(options, stages.oursOid),
    readConflictBlob(options, stages.theirsOid),
  ]);
  if (ours.kind === "unavailable" || theirs.kind === "unavailable") {
    return null;
  }
  const oursContents = ours.kind === "text" ? ours.contents : null;
  const theirsContents = theirs.kind === "text" ? theirs.contents : null;
  const digest = createHash("sha256")
    .update(oursContents ?? "", "utf8")
    .update("\0", "utf8")
    .update(theirsContents ?? "", "utf8")
    .digest("hex");
  return { digest, oursContents, theirsContents };
}

async function readConflictBlob(
  options: ReadGitReviewConflictOptions,
  oid: string | null
): Promise<ConflictStageBlob> {
  if (oid === null || /^0+$/u.test(oid)) {
    return { kind: "absent" };
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid)) {
    return { kind: "unavailable" };
  }
  try {
    const result = await options.execGitRaw(["cat-file", "-p", oid], {
      budget: options.budget,
      cwd: options.gitRootPath,
      env: { GIT_DIFF_OPTS: "" },
      maxOutputBytes: GIT_REVIEW_SNAPSHOT_MAX_BYTES + 1,
      mode: "collect",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (result.kind !== "collected") {
      return { kind: "unavailable" };
    }
    const bytes = result.stdout;
    if (
      bytes.length > GIT_REVIEW_SNAPSHOT_MAX_BYTES ||
      bytes.includes(0) ||
      !isUtf8(bytes)
    ) {
      return { kind: "unavailable" };
    }
    return { contents: bytes.toString("utf8"), kind: "text" };
  } catch (error) {
    if (
      error instanceof GitReviewIndexExecutionError ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }
    return { kind: "unavailable" };
  }
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
