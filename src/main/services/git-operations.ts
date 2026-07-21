import type {
  GitMergeAbortResult,
  GitMergeResult,
  GitRebaseAbortResult,
  GitRebaseContinueResult,
  GitRebaseResult,
  GitRemoteOperationResult,
  GitSequencerAbortResult,
  GitSequencerContinueResult,
  GitSequencerResult,
  GitUndoCommitResult,
} from "../../shared/contracts/git.ts";
import { GitExecError } from "./git-exec.ts";
import { mergeWouldKeepHeadTree } from "./git-merge-preview.ts";
import {
  combinedGitErrorOutput,
  countConflicts,
  errorMessage,
  type GitOperationExec,
  hasConflicts,
  looksLikeConflict,
  resolveGitRootOrUnavailable,
  unavailable,
  WRITE_TIMEOUT_MS,
} from "./git-operation-helpers.ts";

const MERGE_ALREADY_UP_TO_DATE = /^Already up[ -]to[ -]date\.?$/m;
const PARENT_SPLIT_RE = /\s+/;
const REBASE_ALREADY_UP_TO_DATE =
  /^(?:Current branch .+|HEAD) is up to date\.$/m;

export type { GitOperationExec } from "./git-operation-helpers.ts";

export async function mergeBranch(
  execGit: GitOperationExec,
  cwd: string,
  branch: string
): Promise<GitMergeResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  if (await mergeWouldKeepHeadTree(execGit, target.root, branch)) {
    return { kind: "already_up_to_date" };
  }
  try {
    // 裸 merge（默认允许 ff、不跳 hooks）：与 VS Code「Git: Merge Branch」
    // 语义一致，尊重用户 git 配置（merge.ff / branch.<name>.mergeoptions）。
    // --no-edit：GUI 场景无编辑器可开，取 git 默认合并信息。
    const stdout = await execGit(
      ["merge", "--no-edit", "--", branch],
      target.root,
      { timeoutMs: WRITE_TIMEOUT_MS }
    );
    if (MERGE_ALREADY_UP_TO_DATE.test(stdout.trim())) {
      return { kind: "already_up_to_date" };
    }
    return { kind: "ok", message: stdout.trim() };
  } catch (err) {
    if (err instanceof GitExecError) {
      const conflictCount = await countConflicts(execGit, target.root);
      if (conflictCount > 0 || looksLikeConflict(combinedGitErrorOutput(err))) {
        return { conflictCount: Math.max(conflictCount, 1), kind: "conflict" };
      }
    }
    return unavailable(errorMessage(err));
  }
}

export async function abortMerge(
  execGit: GitOperationExec,
  cwd: string
): Promise<GitMergeAbortResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  try {
    await execGit(["merge", "--abort"], target.root, {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return { kind: "ok" };
  } catch (err) {
    return unavailable(errorMessage(err));
  }
}

export async function pushBranch(
  execGit: GitOperationExec,
  cwd: string
): Promise<GitRemoteOperationResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  try {
    await execGit(["push"], target.root, { timeoutMs: WRITE_TIMEOUT_MS });
    return { kind: "ok" };
  } catch (err) {
    return unavailable(errorMessage(err));
  }
}

export async function pullFastForward(
  execGit: GitOperationExec,
  cwd: string
): Promise<GitRemoteOperationResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  try {
    await execGit(["pull", "--ff-only"], target.root, {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return { kind: "ok" };
  } catch (err) {
    return unavailable(errorMessage(err));
  }
}

export async function syncBranch(
  execGit: GitOperationExec,
  cwd: string
): Promise<GitRemoteOperationResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  try {
    // Clean diverged sync rebases local-only commits onto upstream before push.
    // This avoids implicit merge commits while still making Sync actionable.
    await execGit(["pull", "--rebase"], target.root, {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    await execGit(["push"], target.root, { timeoutMs: WRITE_TIMEOUT_MS });
    return { kind: "ok" };
  } catch (err) {
    return unavailable(errorMessage(err));
  }
}

export async function rebaseBranch(
  execGit: GitOperationExec,
  cwd: string,
  branch: string
): Promise<GitRebaseResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  try {
    let successStderr = "";
    const stdout = await execGit(["rebase", "--", branch], target.root, {
      onSuccessStderr: (stderr) => {
        successStderr = stderr;
      },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    if (REBASE_ALREADY_UP_TO_DATE.test(`${stdout}\n${successStderr}`.trim())) {
      return { kind: "already_up_to_date" };
    }
    return { kind: "ok", message: stdout.trim() };
  } catch (err) {
    if (
      err instanceof GitExecError &&
      (looksLikeConflict(combinedGitErrorOutput(err)) ||
        (await hasConflicts(execGit, target.root)))
    ) {
      return { kind: "conflict", message: errorMessage(err) };
    }
    return unavailable(errorMessage(err));
  }
}

export async function abortRebase(
  execGit: GitOperationExec,
  cwd: string
): Promise<GitRebaseAbortResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  try {
    await execGit(["rebase", "--abort"], target.root, {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return { kind: "ok" };
  } catch (err) {
    return unavailable(errorMessage(err));
  }
}

export async function continueRebase(
  execGit: GitOperationExec,
  cwd: string
): Promise<GitRebaseContinueResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  try {
    const stdout = await execGit(["rebase", "--continue"], target.root, {
      env: { GIT_EDITOR: "true" },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return { kind: "ok", message: stdout.trim() };
  } catch (err) {
    if (
      err instanceof GitExecError &&
      (looksLikeConflict(combinedGitErrorOutput(err)) ||
        (await hasConflicts(execGit, target.root)))
    ) {
      return { kind: "conflict", message: errorMessage(err) };
    }
    return unavailable(errorMessage(err));
  }
}

type GitSequencerKind = "cherry-pick" | "revert";

/**
 * cherry-pick / revert 共用主体(与 rebase 语义对齐):
 * 冲突暂停返回 conflict,其余失败返回 unavailable。
 * revert 用 --no-edit 取默认信息;cherry-pick 默认不开编辑器。
 */
async function runSequencer(
  execGit: GitOperationExec,
  cwd: string,
  kind: GitSequencerKind,
  oid: string
): Promise<GitSequencerResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  const args =
    kind === "revert"
      ? ["revert", "--no-edit", "--", oid]
      : ["cherry-pick", "--", oid];
  try {
    const stdout = await execGit(args, target.root, {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return { kind: "ok", message: stdout.trim() };
  } catch (err) {
    if (
      err instanceof GitExecError &&
      (looksLikeConflict(combinedGitErrorOutput(err)) ||
        (await hasConflicts(execGit, target.root)))
    ) {
      return { kind: "conflict", message: errorMessage(err) };
    }
    return unavailable(errorMessage(err));
  }
}

async function abortSequencer(
  execGit: GitOperationExec,
  cwd: string,
  kind: GitSequencerKind
): Promise<GitSequencerAbortResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  try {
    await execGit([kind, "--abort"], target.root, {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return { kind: "ok" };
  } catch (err) {
    return unavailable(errorMessage(err));
  }
}

async function continueSequencer(
  execGit: GitOperationExec,
  cwd: string,
  kind: GitSequencerKind
): Promise<GitSequencerContinueResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  try {
    const stdout = await execGit([kind, "--continue"], target.root, {
      env: { GIT_EDITOR: "true" },
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return { kind: "ok", message: stdout.trim() };
  } catch (err) {
    if (
      err instanceof GitExecError &&
      (looksLikeConflict(combinedGitErrorOutput(err)) ||
        (await hasConflicts(execGit, target.root)))
    ) {
      return { kind: "conflict", message: errorMessage(err) };
    }
    return unavailable(errorMessage(err));
  }
}

export function cherryPickCommit(
  execGit: GitOperationExec,
  cwd: string,
  oid: string
): Promise<GitSequencerResult> {
  return runSequencer(execGit, cwd, "cherry-pick", oid);
}

export function abortCherryPick(
  execGit: GitOperationExec,
  cwd: string
): Promise<GitSequencerAbortResult> {
  return abortSequencer(execGit, cwd, "cherry-pick");
}

export function continueCherryPick(
  execGit: GitOperationExec,
  cwd: string
): Promise<GitSequencerContinueResult> {
  return continueSequencer(execGit, cwd, "cherry-pick");
}

export function revertCommit(
  execGit: GitOperationExec,
  cwd: string,
  oid: string
): Promise<GitSequencerResult> {
  return runSequencer(execGit, cwd, "revert", oid);
}

export function abortRevert(
  execGit: GitOperationExec,
  cwd: string
): Promise<GitSequencerAbortResult> {
  return abortSequencer(execGit, cwd, "revert");
}

export function continueRevert(
  execGit: GitOperationExec,
  cwd: string
): Promise<GitSequencerContinueResult> {
  return continueSequencer(execGit, cwd, "revert");
}

export async function undoLastCommit(
  execGit: GitOperationExec,
  cwd: string
): Promise<GitUndoCommitResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  try {
    await execGit(["rev-parse", "HEAD"], target.root);
  } catch {
    return { kind: "nothing_to_undo" };
  }

  try {
    const headLine = (
      await execGit(["rev-list", "--parents", "-n", "1", "HEAD"], target.root)
    ).trim();
    const hasParent = headLine.split(PARENT_SPLIT_RE).length > 1;
    if (hasParent) {
      await execGit(["reset", "--soft", "HEAD~1"], target.root, {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    } else {
      await execGit(["update-ref", "-d", "HEAD"], target.root, {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    }
    return { kind: "ok" };
  } catch (err) {
    return unavailable(errorMessage(err));
  }
}
