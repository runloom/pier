/**
 * Codex-aligned `git apply-patch`: temp file + `git apply` with target/revert.
 * Review path always uses atomic=true (no --3way).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitApplyPatchResult } from "../../../shared/contracts/git.ts";
import { GitExecError } from "./exec.ts";
import {
  type GitOperationExec,
  resolveGitRootOrUnavailable,
  WRITE_TIMEOUT_MS,
} from "./operation-helpers.ts";

export type GitApplyPatchTarget = "staged" | "staged-and-unstaged" | "unstaged";

export interface GitApplyPatchRequest {
  readonly atomic?: boolean;
  readonly diff: string;
  readonly revert?: boolean;
  readonly target: GitApplyPatchTarget;
}

const PATH_FROM_DIFF_RE = /^diff --git a\/(.*?) b\/(.*)$/gm;

function pathsFromDiff(diff: string): string[] {
  const paths = new Set<string>();
  PATH_FROM_DIFF_RE.lastIndex = 0;
  let match: RegExpExecArray | null = PATH_FROM_DIFF_RE.exec(diff);
  while (match) {
    const a = match[1];
    const b = match[2];
    if (a && a !== "/dev/null") {
      paths.add(a);
    }
    if (b && b !== "/dev/null") {
      paths.add(b);
    }
    match = PATH_FROM_DIFF_RE.exec(diff);
  }
  return [...paths].sort();
}

function emptyResult(
  status: GitApplyPatchResult["status"],
  extra?: Partial<GitApplyPatchResult>
): GitApplyPatchResult {
  return {
    appliedPaths: [],
    conflictedPaths: [],
    skippedPaths: [],
    status,
    ...extra,
  };
}

/**
 * Apply a unified patch via `git apply` (Codex T4 / apply-patch).
 */
export async function applyPatch(
  execGit: GitOperationExec,
  cwd: string,
  request: GitApplyPatchRequest
): Promise<GitApplyPatchResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return emptyResult("error", {
      errorCode: "not-git-repo",
      message: target.message ?? "Git repository unavailable",
    });
  }
  const root = target.root;
  const diff = request.diff.replace(/\r\n/g, "\n");
  if (diff.trim().length === 0) {
    return emptyResult("error", {
      errorCode: "apply-failed",
      message: "Empty patch",
    });
  }

  const atomic = request.atomic !== false;
  const revert = request.revert === true;
  const applyTarget = request.target;

  const tempRoot = await mkdtemp(join(tmpdir(), "pier-apply-"));
  const patchPath = join(tempRoot, "patch.diff");
  try {
    await writeFile(
      patchPath,
      diff.endsWith("\n") ? diff : `${diff}\n`,
      "utf8"
    );

    const args: string[] = ["apply"];
    if (revert) {
      args.push("-R");
    }
    if (!atomic) {
      args.push("--3way");
    }
    if (applyTarget === "staged") {
      args.push("--cached");
    } else if (applyTarget === "staged-and-unstaged") {
      args.push("--index");
    }
    args.push(patchPath);

    try {
      await execGit(args, root, { timeoutMs: WRITE_TIMEOUT_MS });
      return {
        appliedPaths: pathsFromDiff(diff),
        conflictedPaths: [],
        skippedPaths: [],
        status: "success",
      };
    } catch (error) {
      if (error instanceof GitExecError) {
        const exitCode = error.exitCode;
        const message = (error.stderr || error.stdout || error.message).trim();
        // Codex: n===1 && !atomic → partial-success; review uses atomic.
        if (exitCode === 1 && !atomic) {
          return {
            appliedPaths: pathsFromDiff(diff),
            conflictedPaths: [],
            message: message || undefined,
            skippedPaths: [],
            status: "partial-success",
          };
        }
        return emptyResult("error", {
          errorCode: "apply-failed",
          message: message || "git apply failed",
        });
      }
      return emptyResult("error", {
        errorCode: "apply-failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    await rm(tempRoot, { force: true, recursive: true }).catch(() => undefined);
  }
}
