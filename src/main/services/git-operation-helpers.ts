import { validateGitCwd } from "./git-cwd.ts";
import { GitExecError } from "./git-exec.ts";

/** 写操作统一 60s 超时(避免大仓库继承 git-exec 默认 10s 失败)。 */
export const WRITE_TIMEOUT_MS = 60_000;
const CONFLICT_RE = /CONFLICT|merge conflict|unmerged/i;

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
