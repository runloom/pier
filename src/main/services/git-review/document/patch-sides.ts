import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import type { ExecGitRaw } from "../../git/exec.ts";
import {
  GitExecRawError,
  type GitExecRawResult,
} from "../../git/exec-raw-contract.ts";
import { GitReviewIndexExecutionError } from "../index/contract.ts";
import { GitReviewPathError } from "../path/contract.ts";
import {
  GIT_REVIEW_SNAPSHOT_MAX_BYTES,
  readGitReviewFileSnapshot,
} from "../path/guard.ts";
import {
  GitReviewDocumentStaleError,
  type GitReviewPatchMaterial,
  type GitReviewRenderableGroup,
  type ReadGitReviewPatchOptions,
} from "./patch-contract.ts";
import { tryReadFingerprint } from "./patch-snapshot.ts";

/** Same as conflict worktree snapshot so expand works for every admitted text file. */
export const GIT_REVIEW_DIFF_SIDES_MAX_BYTES = GIT_REVIEW_SNAPSHOT_MAX_BYTES;

const GIT_BLOB_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export interface GitReviewDiffSides {
  readonly newContents: string;
  readonly oldContents: string;
}

export interface GitReviewWorktreeFence {
  readonly digest: string;
  readonly identityToken: string;
}

export interface GitReviewPatchCollection {
  readonly material: GitReviewPatchMaterial;
  readonly worktreeFence: GitReviewWorktreeFence | null;
}

/**
 * Full old/new text for Pierre `processFile({ oldFile, newFile })`.
 * Lets collapsed "N 行未修改" expand like UnresolvedFile (`isPartial=false`).
 * Miss / binary / oversize → leave the patch partial.
 * Worktree digest drift vs the patch fence → stale retry, not mismatched full text.
 */
export async function withGitReviewDiffSides(
  options: ReadGitReviewPatchOptions,
  material: GitReviewPatchMaterial,
  worktreeFence: GitReviewWorktreeFence | null = null
): Promise<GitReviewPatchMaterial> {
  if (material.kind !== "patch") {
    return material;
  }
  try {
    const sides = await tryReadGitReviewDiffSides(options, material);
    if (sides === null) {
      return material;
    }
    if (worktreeFence !== null) {
      await assertWorktreeFenceHolds(options, worktreeFence);
    }
    return Object.freeze({
      ...material,
      newContents: sides.newContents,
      oldContents: sides.oldContents,
      sourceRevision: `${material.sourceRevision}${diffSidesRevisionSuffix(sides)}`,
    });
  } catch (error) {
    if (
      isFatalSideError(error) ||
      error instanceof GitReviewDocumentStaleError
    ) {
      throw error;
    }
    return material;
  }
}

export function patchSectionContents(
  material: Extract<GitReviewPatchMaterial, { kind: "patch" }>
): {
  readonly newContents?: string;
  readonly oldContents?: string;
} {
  if (
    material.oldContents === undefined ||
    material.newContents === undefined
  ) {
    return {};
  }
  return {
    newContents: material.newContents,
    oldContents: material.oldContents,
  };
}

export async function tryReadGitReviewDiffSides(
  options: ReadGitReviewPatchOptions,
  material: Extract<GitReviewPatchMaterial, { kind: "patch" }>
): Promise<GitReviewDiffSides | null> {
  const oldContents = await readOldSide(options, material);
  if (oldContents === null) {
    return null;
  }
  const newContents = await readNewSide(options, material);
  if (newContents === null) {
    return null;
  }
  return { newContents, oldContents };
}

function diffSidesRevisionSuffix(sides: GitReviewDiffSides): string {
  const digest = createHash("sha256")
    .update("pier.git-review.diff-sides.v1\0", "utf8")
    .update(sides.oldContents, "utf8")
    .update("\0", "utf8")
    .update(sides.newContents, "utf8")
    .digest("hex");
  return `:sides:${digest}`;
}

async function readOldSide(
  options: ReadGitReviewPatchOptions,
  material: Extract<GitReviewPatchMaterial, { kind: "patch" }>
): Promise<string | null> {
  if (isPresentOid(material.sourceOid)) {
    return readBlobUtf8(options, material.sourceOid);
  }
  if (options.fact.status === "added" || options.fact.origin === "untracked") {
    return "";
  }
  return null;
}

async function readNewSide(
  options: ReadGitReviewPatchOptions,
  material: Extract<GitReviewPatchMaterial, { kind: "patch" }>
): Promise<string | null> {
  if (options.fact.status === "deleted") {
    return "";
  }
  if (usesWorktreeNewSide(options.group)) {
    return readWorktreeUtf8(options);
  }
  if (!isPresentOid(material.targetOid)) {
    return null;
  }
  return readBlobUtf8(options, material.targetOid);
}

function usesWorktreeNewSide(group: GitReviewRenderableGroup): boolean {
  return group === "unstaged" || group === "working";
}

function isPresentOid(oid: string | null): oid is string {
  return oid !== null && GIT_BLOB_OID_PATTERN.test(oid) && !/^0+$/u.test(oid);
}

async function assertWorktreeFenceHolds(
  options: ReadGitReviewPatchOptions,
  fence: GitReviewWorktreeFence
): Promise<void> {
  const after = await tryReadFingerprint(options);
  if (after.kind === "state") {
    throw new GitReviewDocumentStaleError(
      "Git Review worktree 文件在 diff sides 读取后不可读取"
    );
  }
  if (
    after.snapshot.digest !== fence.digest ||
    after.snapshot.identityToken !== fence.identityToken
  ) {
    throw new GitReviewDocumentStaleError(
      "Git Review worktree 文件在 diff sides 读取期间发生变化"
    );
  }
}

async function readWorktreeUtf8(
  options: ReadGitReviewPatchOptions
): Promise<string | null> {
  try {
    const snapshot = await readGitReviewFileSnapshot({
      budget: options.budget,
      gitRootPath: options.gitRootPath,
      maxBytes: GIT_REVIEW_DIFF_SIDES_MAX_BYTES,
      path: options.fact.targetPath,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return decodeUtf8Side(snapshot.bytes);
  } catch (error) {
    if (!(error instanceof GitReviewPathError)) {
      throw error;
    }
    if (error.reason === "aborted") {
      rethrowAborted(options);
    }
    if (error.reason === "changed" || error.reason === "missing") {
      throw new GitReviewDocumentStaleError(error.message, { cause: error });
    }
    return null;
  }
}

async function readBlobUtf8(
  options: ReadGitReviewPatchOptions,
  oid: string
): Promise<string | null> {
  let result: GitExecRawResult;
  try {
    result = await catFile(options.execGitRaw, oid, options);
  } catch (error) {
    if (isFatalSideError(error)) {
      throw error;
    }
    return null;
  }
  if (result.kind !== "collected") {
    return null;
  }
  return decodeUtf8Side(result.stdout);
}

async function catFile(
  execGitRaw: ExecGitRaw,
  oid: string,
  options: ReadGitReviewPatchOptions
): Promise<GitExecRawResult> {
  return execGitRaw(["cat-file", "-p", oid], {
    budget: options.budget,
    cwd: options.gitRootPath,
    env: { GIT_DIFF_OPTS: "" },
    maxOutputBytes: GIT_REVIEW_DIFF_SIDES_MAX_BYTES + 1,
    mode: "collect",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

function decodeUtf8Side(bytes: Buffer): string | null {
  if (bytes.length > GIT_REVIEW_DIFF_SIDES_MAX_BYTES) {
    return null;
  }
  if (bytes.includes(0) || !isUtf8(bytes)) {
    return null;
  }
  return bytes.toString("utf8");
}

function rethrowAborted(options: ReadGitReviewPatchOptions): never {
  const budgetFailure = options.budget.failureReason();
  if (budgetFailure !== null) {
    throw new GitReviewIndexExecutionError(
      budgetFailure,
      `Git Review diff sides ${budgetFailure}`
    );
  }
  throw new GitReviewIndexExecutionError(
    "aborted",
    "Git Review diff sides 已取消"
  );
}

function isFatalSideError(error: unknown): boolean {
  if (error instanceof GitReviewIndexExecutionError) {
    return error.kind === "aborted";
  }
  if (error instanceof GitExecRawError) {
    return error.causeKind === "aborted";
  }
  return error instanceof Error && error.name === "AbortError";
}
