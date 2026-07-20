import type { z } from "zod";
import type {
  gitDiffOptionsSchema,
  gitLogOptionsSchema,
} from "../../shared/contracts/git.ts";
import { execGit } from "./git-exec.ts";

/** 从 contracts schema 派生的 IPC 兼容 option 类型,避免 exactOptionalPropertyTypes 冲突。 */
export type GitDiffOptions = z.infer<typeof gitDiffOptionsSchema>;
export type GitLogOptions = z.infer<typeof gitLogOptionsSchema>;

export const GIT_LOG_FORMAT = "%H%x1f%an%x1f%aI%x1f%s%x1e";
const ORIGIN_HEAD_RE = /^refs\/remotes\/origin\/(.+)$/;

export interface GitServiceExecOptions {
  env?: Readonly<Record<string, string>>;
  onSuccessStderr?: (stderr: string) => void;
  timeoutMs?: number;
}

export type GitServiceExec = (
  args: readonly string[],
  cwd: string,
  options?: GitServiceExecOptions
) => Promise<string>;

export function diffRangeArgs(options: GitDiffOptions): string[] {
  const args: string[] = [];
  if (options.staged) {
    args.push("--cached");
  }
  if (options.from && options.to) {
    args.push(
      `${safeGitRevision(options.from, "diff from")}..${safeGitRevision(
        options.to,
        "diff to"
      )}`
    );
  } else if (options.from) {
    args.push(safeGitRevision(options.from, "diff from"));
  }
  if (options.paths && options.paths.length > 0) {
    args.push("--", ...options.paths);
  }
  return args;
}

export function safeGitRevision(value: string, label: string): string {
  if (value.startsWith("-")) {
    throw new Error(`${label} must not start with "-"`);
  }
  return value;
}

export function logArgs(options: GitLogOptions): string[] {
  const maxCount = options.maxCount ?? 50;
  const args: string[] = [
    "log",
    `--format=${GIT_LOG_FORMAT}`,
    `--max-count=${maxCount}`,
  ];
  if (options.author) {
    args.push(`--author=${options.author}`);
  }
  if (options.grep) {
    args.push(`--grep=${options.grep}`);
  }
  if (options.since) {
    args.push(`--since=${options.since}`);
  }
  if (options.until) {
    args.push(`--until=${options.until}`);
  }
  if (options.path) {
    args.push("--", options.path);
  }
  return args;
}

export function defaultExecGit(
  args: readonly string[],
  cwd: string,
  options?: GitServiceExecOptions
): Promise<string> {
  return execGit(args, { cwd, ...options });
}

export function withResolvedEnvironment(
  exec: GitServiceExec,
  resolveEnvironment:
    | ((cwd: string) => Promise<Readonly<Record<string, string>>>)
    | undefined
): GitServiceExec {
  if (!resolveEnvironment) {
    return exec;
  }
  return async (args, cwd, options) => {
    let env: Readonly<Record<string, string>>;
    try {
      env = await resolveEnvironment(cwd);
    } catch {
      env = {};
    }
    return exec(args, cwd, {
      ...options,
      env: { ...env, ...(options?.env ?? {}) },
    });
  };
}

export async function readHeadOid(
  cwd: string,
  exec: (args: readonly string[], cwd: string) => Promise<string>
): Promise<string | null> {
  try {
    return (await exec(["rev-parse", "--verify", "HEAD"], cwd)).trim();
  } catch {
    return null;
  }
}

export async function readDefaultBranch(
  cwd: string,
  exec: (args: readonly string[], cwd: string) => Promise<string>
): Promise<string | null> {
  try {
    const out = (
      await exec(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd)
    ).trim();
    return ORIGIN_HEAD_RE.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}
