import type {
  GitMergeAbortResult,
  GitMergeResult,
  GitRebaseAbortResult,
  GitRebaseContinueResult,
  GitRebaseResult,
  GitStashEntry,
  GitStashListResult,
  GitStashPopResult,
  GitStashResult,
  GitUndoCommitResult,
} from "../../shared/contracts/git.ts";
import { validateGitCwd } from "./git-cwd.ts";
import { GitExecError } from "./git-exec.ts";

const WRITE_TIMEOUT_MS = 60_000;
const CONFLICT_RE = /CONFLICT|merge conflict|unmerged/i;
const MERGE_ALREADY_UP_TO_DATE = /^Already up[ -]to[ -]date\.?$/m;
const NO_LOCAL_CHANGES_RE = /No local changes/i;
const PARENT_SPLIT_RE = /\s+/;
const REBASE_ALREADY_UP_TO_DATE =
  /^(?:Current branch .+|HEAD) is up to date\.$/m;
const STASH_REF_RE = /^stash@\{(\d+)\}$/;

export type GitOperationExec = (
  args: readonly string[],
  cwd: string,
  options?: {
    env?: Readonly<Record<string, string>>;
    onSuccessStderr?: (stderr: string) => void;
    timeoutMs?: number;
  }
) => Promise<string>;

function combinedGitErrorOutput(error: GitExecError): string {
  return `${error.stderr}\n${error.stdout}`;
}

function unavailable(message?: string): {
  kind: "unavailable";
  message: null | string;
} {
  return {
    kind: "unavailable",
    message: message || null,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof GitExecError) {
    return capMessage(error.stderr || error.stdout || error.message);
  }
  return capMessage(error instanceof Error ? error.message : String(error));
}

function capMessage(message: string, maxLength = 2000): string {
  const trimmed = message.trim();
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength - 1)}…`
    : trimmed;
}

function looksLikeConflict(output: string): boolean {
  return CONFLICT_RE.test(output);
}

async function resolveGitRootOrUnavailable(
  execGit: GitOperationExec,
  cwd: string
): Promise<
  { kind: "ok"; root: string } | { kind: "unavailable"; message: null | string }
> {
  const root = await validateGitCwd(execGit, cwd);
  return root ? { kind: "ok", root } : unavailable("Invalid git repository");
}

async function countConflicts(
  execGit: GitOperationExec,
  cwd: string
): Promise<number> {
  try {
    const output = await execGit(
      ["diff", "--name-only", "--diff-filter=U"],
      cwd
    );
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function hasConflicts(
  execGit: GitOperationExec,
  cwd: string
): Promise<boolean> {
  return (await countConflicts(execGit, cwd)) > 0;
}

export async function mergeBranch(
  execGit: GitOperationExec,
  cwd: string,
  branch: string
): Promise<GitMergeResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  try {
    const stdout = await execGit(
      ["merge", "--no-edit", "--no-verify", "--", branch],
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

export async function popStash(
  execGit: GitOperationExec,
  cwd: string,
  index: number | undefined
): Promise<GitStashPopResult> {
  const target = await resolveGitRootOrUnavailable(execGit, cwd);
  if (target.kind === "unavailable") {
    return target;
  }
  const stashRef = index === undefined ? [] : [`stash@{${index}}`];
  // 基线：pop 前已存在的未合并文件不能归因于本次 pop。
  const conflictsBefore = await countConflicts(execGit, target.root);
  try {
    await execGit(["stash", "pop", ...stashRef], target.root, {
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
