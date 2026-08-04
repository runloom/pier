import { validateGitCwd } from "./cwd.ts";
import { GitExecError } from "./exec.ts";

/** 写操作统一 60s 超时(避免大仓库继承 git-exec 默认 10s 失败)。 */
export const WRITE_TIMEOUT_MS = 60_000;
const CONFLICT_RE = /CONFLICT|merge conflict|unmerged/i;

/**
 * 用户没配 GIT_SSH_COMMAND 时补 BatchMode，防 ssh passphrase 询问挂起。
 * fetch / push / pull / publish / sync / autofetch 共用。
 */
export function sshBatchEnv(): Readonly<Record<string, string>> {
  if (process.env.GIT_SSH_COMMAND) {
    return {};
  }
  return { GIT_SSH_COMMAND: "ssh -oBatchMode=yes" };
}

/** 产品层稳定文案键：无上游（与 remote-error 分类对齐）。 */
export const NO_UPSTREAM_MESSAGE =
  "No upstream is configured for the current branch";

export type GitOperationExec = (
  args: readonly string[],
  cwd: string,
  options?: {
    env?: Readonly<Record<string, string>>;
    onSuccessStderr?: (stderr: string) => void;
    timeoutMs?: number;
  }
) => Promise<string>;

export function combinedGitErrorOutput(error: GitExecError): string {
  return `${error.stderr}\n${error.stdout}`;
}

export function unavailable(message?: string): {
  kind: "unavailable";
  message: null | string;
} {
  return {
    kind: "unavailable",
    message: message || null,
  };
}

export function errorMessage(error: unknown): string {
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

export function looksLikeConflict(output: string): boolean {
  return CONFLICT_RE.test(output);
}

export async function resolveGitRootOrUnavailable(
  execGit: GitOperationExec,
  cwd: string
): Promise<
  { kind: "ok"; root: string } | { kind: "unavailable"; message: null | string }
> {
  const root = await validateGitCwd(execGit, cwd);
  return root ? { kind: "ok", root } : unavailable("Invalid git repository");
}

export async function countConflicts(
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

export async function hasConflicts(
  execGit: GitOperationExec,
  cwd: string
): Promise<boolean> {
  return (await countConflicts(execGit, cwd)) > 0;
}

/**
 * 当前分支是否配置了可用的 upstream。
 * 未配置、或 upstream gone（远端 ref 已删）均返回 false → pull/sync 应拒绝。
 */
export async function hasUpstreamConfigured(
  execGit: GitOperationExec,
  cwd: string
): Promise<boolean> {
  try {
    await execGit(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd, {
      timeoutMs: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析本仓库全部 worktree 路径（含主仓），供 remoteSync fan-out。
 * 失败时至少返回 [root]。
 */
export async function listWorktreePaths(
  execGit: GitOperationExec,
  root: string
): Promise<string[]> {
  try {
    const output = await execGit(["worktree", "list", "--porcelain"], root, {
      timeoutMs: 15_000,
    });
    const paths: string[] = [];
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        const p = line.slice("worktree ".length).trim();
        if (p.length > 0) {
          paths.push(p);
        }
      }
    }
    return paths.length > 0 ? paths : [root];
  } catch {
    return [root];
  }
}
