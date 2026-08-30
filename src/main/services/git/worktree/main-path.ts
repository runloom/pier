import { parseGitWorktreeListPorcelainZ } from "./parser.ts";
import { safeRealpath } from "./paths.ts";

export interface GitWorktreeFamily {
  /** Linked worktrees; excludes `mainPath`. */
  linkedPaths: string[];
  /** Primary checkout (`git worktree list` first entry). */
  mainPath: string;
}

export interface ResolveGitWorktreeFamilyDeps {
  execGit: (args: readonly string[], cwd: string) => Promise<string>;
  realpath: (path: string) => Promise<string>;
}

/**
 * Resolve the git primary checkout and its linked worktrees.
 * Returns null when `path` is not inside a git work tree.
 */
export async function resolveGitWorktreeFamily(
  path: string,
  deps: ResolveGitWorktreeFamilyDeps
): Promise<GitWorktreeFamily | null> {
  const resolved = await safeRealpath(path, deps.realpath);
  let toplevel: string;
  try {
    toplevel = (
      await deps.execGit(["rev-parse", "--show-toplevel"], resolved)
    ).trim();
  } catch {
    return null;
  }
  if (toplevel.length === 0) {
    return null;
  }
  const realToplevel = await safeRealpath(toplevel, deps.realpath);

  let output: string;
  try {
    output = await deps.execGit(
      ["worktree", "list", "--porcelain", "-z"],
      realToplevel
    );
  } catch {
    return { linkedPaths: [], mainPath: realToplevel };
  }

  const items = parseGitWorktreeListPorcelainZ(output, realToplevel);
  const mainPath = items[0]?.path
    ? await safeRealpath(items[0].path, deps.realpath)
    : realToplevel;
  const linkedPaths: string[] = [];
  const seen = new Set<string>([mainPath]);
  for (const item of items.slice(1)) {
    if (item.bare) {
      continue;
    }
    const linked = await safeRealpath(item.path, deps.realpath);
    if (seen.has(linked)) {
      continue;
    }
    seen.add(linked);
    linkedPaths.push(linked);
  }
  return { linkedPaths, mainPath };
}
