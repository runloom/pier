import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execGit } from "./git-exec.ts";

// 整目录被 gitignore 时 `--directory` 会折叠为单条目录项(如 node_modules/),
// 其内部文件不会枚举 —— 目录级复制不在 P1 范围。
const HARD_EXCLUDED_PREFIXES = [
  ".git/",
  ".worktrees/",
  "dist/",
  "node_modules/",
  "out/",
] as const;

export interface CopyWorktreeIncludesArgs {
  execGit?: (
    args: readonly string[],
    cwd: string,
    options?: { timeoutMs?: number }
  ) => Promise<string>;
  mainPath: string;
  patterns: readonly string[];
  targetPath: string;
}

export interface CopyWorktreeIncludesResult {
  copied: string[];
  skipped: string[];
}

function defaultExecGit(
  args: readonly string[],
  cwd: string,
  options?: { timeoutMs?: number }
): Promise<string> {
  return execGit(args, { cwd, ...options });
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

export function matchesCopyPattern(relPath: string, pattern: string): boolean {
  const target = pattern.includes("/")
    ? relPath
    : (relPath.split("/").at(-1) ?? relPath);
  return globToRegExp(pattern).test(target);
}

export async function copyWorktreeIncludes({
  execGit: exec = defaultExecGit,
  mainPath,
  patterns,
  targetPath,
}: CopyWorktreeIncludesArgs): Promise<CopyWorktreeIncludesResult> {
  if (patterns.length === 0) {
    return { copied: [], skipped: [] };
  }
  const output = await exec(
    [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ],
    mainPath,
    { timeoutMs: 30_000 }
  );
  const entries = output.split("\0").filter((entry) => entry.length > 0);
  const copied: string[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    if (entry.endsWith("/")) {
      continue;
    }
    if (HARD_EXCLUDED_PREFIXES.some((prefix) => entry.startsWith(prefix))) {
      continue;
    }
    if (!patterns.some((pattern) => matchesCopyPattern(entry, pattern))) {
      continue;
    }
    try {
      await mkdir(dirname(join(targetPath, entry)), { recursive: true });
      await copyFile(
        join(mainPath, entry),
        join(targetPath, entry),
        fsConstants.COPYFILE_EXCL
      );
      copied.push(entry);
    } catch (err) {
      console.warn(
        "[worktree-bootstrap] copy failed:",
        entry,
        err instanceof Error ? err.message : err
      );
      skipped.push(entry);
    }
  }
  return { copied, skipped };
}
