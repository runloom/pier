import type {
  GitStashApplyResult,
  GitStashDropResult,
  GitStashEntry,
  GitStashListResult,
  GitStashPopResult,
  GitStashResult,
} from "../../shared/contracts/git.ts";
import { GitExecError } from "./git-exec.ts";
import {
  combinedGitErrorOutput,
  countConflicts,
  errorMessage,
  type GitOperationExec,
  looksLikeConflict,
  resolveGitRootOrUnavailable,
  unavailable,
  WRITE_TIMEOUT_MS,
} from "./git-operation-helpers.ts";

const NO_LOCAL_CHANGES_RE = /No local changes/i;
const STASH_REF_RE = /^stash@\{(\d+)\}$/;

export async function stashChanges(
  execGit: GitOperationExec,
  cwd: string,
  options: { includeUntracked?: boolean; message?: string }
): Promise<GitStashResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  const args = ["stash", "push"];
  if (options.message) {
    args.push("-m", options.message);
  }
  if (options.includeUntracked) {
    args.push("--include-untracked");
  }
  try {
    const output = await execGit(args, target.root, {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    if (NO_LOCAL_CHANGES_RE.test(output)) {
      return { kind: "nothing_to_stash" };
    }
    return { kind: "ok" };
  } catch (err) {
    return unavailable(errorMessage(err));
  }
}

/**
 * pop/apply 共用主体：仅差子命令；conflict 归因用操作前基线抵扣。
 * 返回并集：GitStashApplyResult 当前是 GitStashPopResult 的契约别名，
 * 若未来 apply 单独扩展 kind，此处签名会强制两个出口显式分流。
 */
async function applyStashLike(
  execGit: GitOperationExec,
  cwd: string,
  index: number | undefined,
  subcommand: "apply" | "pop"
): Promise<GitStashPopResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  const stashRef = index === undefined ? [] : [`stash@{${index}}`];
  // 基线：操作前已存在的未合并文件不能归因于本次 pop/apply。
  const conflictsBefore = await countConflicts(execGit, target.root);
  try {
    await execGit(["stash", subcommand, ...stashRef], target.root, {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return { kind: "ok" };
  } catch (err) {
    if (
      err instanceof GitExecError &&
      (looksLikeConflict(combinedGitErrorOutput(err)) ||
        (await countConflicts(execGit, target.root)) > conflictsBefore)
    ) {
      return { kind: "conflict" };
    }
    return unavailable(errorMessage(err));
  }
}

export function popStash(
  execGit: GitOperationExec,
  cwd: string,
  index: number | undefined
): Promise<GitStashPopResult> {
  return applyStashLike(execGit, cwd, index, "pop");
}

export function applyStash(
  execGit: GitOperationExec,
  cwd: string,
  index: number | undefined
): Promise<GitStashApplyResult> {
  return applyStashLike(execGit, cwd, index, "apply");
}

export async function dropStash(
  execGit: GitOperationExec,
  cwd: string,
  index: number | undefined
): Promise<GitStashDropResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  const stashRef = index === undefined ? [] : [`stash@{${index}}`];
  try {
    await execGit(["stash", "drop", ...stashRef], target.root, {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return { kind: "ok" };
  } catch (err) {
    return unavailable(errorMessage(err));
  }
}

export function parseStashEntries(output: string): GitStashEntry[] {
  const entries: GitStashEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [ref, message = "", date = "", hash = ""] = line.split("\x1f");
    const match = STASH_REF_RE.exec(ref ?? "");
    if (!match) {
      continue;
    }
    entries.push({ date, hash, index: Number(match[1]), message });
  }
  return entries;
}

export async function listStashes(
  execGit: GitOperationExec,
  cwd: string
): Promise<GitStashListResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  try {
    const output = await execGit(cwdStashListArgs(), target.root);
    return { entries: parseStashEntries(output), kind: "ok" };
  } catch (err) {
    return unavailable(errorMessage(err));
  }
}

function cwdStashListArgs(): string[] {
  return ["stash", "list", "--format=%gd%x1f%gs%x1f%aI%x1f%H"];
}
