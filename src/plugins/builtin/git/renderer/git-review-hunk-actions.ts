/**
 * Codex-aligned hunk actions: extract unified hunk patch → git.applyPatch.
 *
 * Vx mapping (from Codex app):
 * - stage   → { target: "staged", revert: false }
 * - unstage → { target: "staged", revert: true }
 * - revert (unstaged) → { target: "unstaged", revert: true }
 * - revert (staged)   → staged reverse then unstaged reverse
 */

import type { GitApplyPatchResult } from "@shared/contracts/git.ts";
import {
  extractChangeBlockPatch,
  extractHunkPatch,
} from "@shared/git-patch-hunk.ts";

export type HunkGitAction = "stage" | "unstage" | "revert";

/** Stable codes for call-site i18n; technical git stderr stays in `message`. */
export type HunkGitActionErrorCode =
  | "extract-failed"
  | "apply-failed"
  | "partial-revert-worktree";

export interface ApplyHunkPatchParams {
  readonly action: HunkGitAction;
  readonly applyPatch: (
    cwd: string,
    options: {
      atomic?: boolean;
      diff: string;
      revert?: boolean;
      target: "staged" | "unstaged" | "staged-and-unstaged";
    }
  ) => Promise<GitApplyPatchResult>;
  /** 0-based change island inside the @@ hunk; default 0. */
  readonly changeBlockIndex?: number;
  readonly cwd: string;
  readonly filePatch: string;
  readonly hunkIndex: number;
  readonly variant: "staged" | "unstaged";
}

export interface ApplyHunkGitActionResult {
  readonly errorCode?: HunkGitActionErrorCode;
  /** Technical detail (git stderr); never a product title. */
  readonly message?: string;
  readonly ok: boolean;
}

/** Whole-@@ extract helper (tests / callers that intentionally ignore islands). */
export function tryExtractHunkPatch(
  filePatch: string,
  hunkIndex: number
): string | null {
  try {
    return extractHunkPatch(filePatch, [hunkIndex]);
  } catch {
    return null;
  }
}

export function tryExtractChangeBlockPatch(
  filePatch: string,
  hunkIndex: number,
  changeBlockIndex = 0
): string | null {
  try {
    return extractChangeBlockPatch(filePatch, hunkIndex, changeBlockIndex);
  } catch {
    return null;
  }
}

function resultFail(
  errorCode: HunkGitActionErrorCode,
  message?: string
): ApplyHunkGitActionResult {
  if (message === undefined || message.length === 0) {
    return { errorCode, ok: false };
  }
  return { errorCode, message, ok: false };
}

function resultFromApply(
  result: GitApplyPatchResult
): ApplyHunkGitActionResult {
  if (result.status === "success") {
    return { ok: true };
  }
  return resultFail("apply-failed", result.message);
}

/**
 * Run Codex-style apply-patch for one hunk / change block.
 */
export async function applyHunkGitAction(
  params: ApplyHunkPatchParams
): Promise<ApplyHunkGitActionResult> {
  const changeBlockIndex = params.changeBlockIndex ?? 0;
  const diff = tryExtractChangeBlockPatch(
    params.filePatch,
    params.hunkIndex,
    changeBlockIndex
  );
  if (!diff) {
    return resultFail("extract-failed");
  }

  if (params.action === "stage") {
    return resultFromApply(
      await params.applyPatch(params.cwd, {
        atomic: true,
        diff,
        revert: false,
        target: "staged",
      })
    );
  }

  if (params.action === "unstage") {
    return resultFromApply(
      await params.applyPatch(params.cwd, {
        atomic: true,
        diff,
        revert: true,
        target: "staged",
      })
    );
  }

  // revert
  if (params.variant === "unstaged") {
    return resultFromApply(
      await params.applyPatch(params.cwd, {
        atomic: true,
        diff,
        revert: true,
        target: "unstaged",
      })
    );
  }

  // staged revert: reverse --cached then reverse worktree.
  // If worktree step fails, re-stage to avoid half-reverted index/worktree split.
  const staged = await params.applyPatch(params.cwd, {
    atomic: true,
    diff,
    revert: true,
    target: "staged",
  });
  if (staged.status !== "success") {
    return resultFail("apply-failed", staged.message);
  }
  const unstaged = await params.applyPatch(params.cwd, {
    atomic: true,
    diff,
    revert: true,
    target: "unstaged",
  });
  if (unstaged.status === "success") {
    return { ok: true };
  }
  const restage = await params.applyPatch(params.cwd, {
    atomic: true,
    diff,
    revert: false,
    target: "staged",
  });
  if (restage.status === "success") {
    // Restored prior staged state; surface original worktree failure.
    return resultFail("apply-failed", unstaged.message);
  }
  return resultFail(
    "partial-revert-worktree",
    unstaged.message ?? restage.message
  );
}
