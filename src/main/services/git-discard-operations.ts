/**
 * Discard working-tree changes (VS Code repository.clean semantics).
 * Tracked paths → `git restore`; untracked → OS Trash, then `git clean -f -d`.
 */
import path from "node:path";
import type { GitServiceExec } from "./git-service-support.ts";

const WRITE_TIMEOUT_MS = 60_000;

export type TrashItem = (absolutePath: string) => Promise<void>;

export async function trashViaElectronShell(
  absolutePath: string
): Promise<void> {
  // Dynamic import: electron is unavailable under pure-Node vitest.
  const { shell } = await import("electron");
  await shell.trashItem(absolutePath);
}

/** Resolve repo-relative path under cwd; reject `..` escapes. */
export function resolvePathUnderRepo(
  cwd: string,
  relativePath: string
): string {
  const root = path.resolve(cwd);
  const absolute = path.resolve(root, relativePath);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (absolute !== root && !absolute.startsWith(prefix)) {
    throw new Error(`path escapes repository: ${relativePath}`);
  }
  return absolute;
}

export async function discardChanges(
  runGit: GitServiceExec,
  cwd: string,
  paths: readonly string[],
  trashItem: TrashItem
): Promise<void> {
  if (paths.length === 0) {
    throw new Error("discardChanges requires at least one path");
  }
  // Classify via index membership (ls-files).
  const listed = await runGit(["ls-files", "-z", "--", ...paths], cwd, {
    timeoutMs: WRITE_TIMEOUT_MS,
  });
  const trackedInIndex = new Set(
    listed.split("\0").filter((entry) => entry.length > 0)
  );
  const trackedPaths: string[] = [];
  const untrackedPaths: string[] = [];
  for (const repoPath of paths) {
    if (trackedInIndex.has(repoPath)) {
      trackedPaths.push(repoPath);
    } else {
      untrackedPaths.push(repoPath);
    }
  }
  if (trackedPaths.length > 0) {
    await runGit(["restore", "--", ...trackedPaths], cwd, {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  }
  for (const repoPath of untrackedPaths) {
    const absolute = resolvePathUnderRepo(cwd, repoPath);
    try {
      await trashItem(absolute);
    } catch {
      // Trash unsupported (remote FS, snap, etc.) → permanent clean.
      await runGit(["clean", "-f", "-d", "--", repoPath], cwd, {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    }
  }
}
