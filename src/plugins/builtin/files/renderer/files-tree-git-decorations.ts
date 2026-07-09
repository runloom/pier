import type { PierFileTreeGitStatus } from "@pier/ui/file-tree.tsx";
import type { GitStatus } from "@shared/contracts/git.ts";

export interface FilesGitDecorations {
  changedByPath: ReadonlyMap<string, PierFileTreeGitStatus>;
  ignoredDirs: readonly string[];
  ignoredFiles: ReadonlySet<string>;
}

export const EMPTY_GIT_DECORATIONS: FilesGitDecorations = {
  changedByPath: new Map(),
  ignoredDirs: [],
  ignoredFiles: new Set(),
};

const TRAILING_SLASH_PATTERN = /\/+$/;

function gitStatusForCodes(
  index: string,
  worktree: string
): PierFileTreeGitStatus | null {
  const codes = `${index}${worktree}`;
  if (codes.includes("?")) {
    return "untracked";
  }
  if (codes.includes("A")) {
    return "added";
  }
  if (codes.includes("D")) {
    return "deleted";
  }
  if (codes.includes("R")) {
    return "renamed";
  }
  if (codes.includes("M") || codes.includes("U")) {
    return "modified";
  }
  return null;
}

export function splitIgnoredEntries(entries: readonly string[]): {
  ignoredDirs: string[];
  ignoredFiles: Set<string>;
} {
  const ignoredDirs: string[] = [];
  const ignoredFiles = new Set<string>();
  for (const entry of entries) {
    if (entry.endsWith("/")) {
      ignoredDirs.push(entry.replace(TRAILING_SLASH_PATTERN, ""));
    } else {
      ignoredFiles.add(entry);
    }
  }
  return { ignoredDirs, ignoredFiles };
}

export function ignoredStatusFor(
  path: string,
  decorations: FilesGitDecorations
): PierFileTreeGitStatus | null {
  if (decorations.ignoredFiles.has(path)) {
    return "ignored";
  }
  for (const dir of decorations.ignoredDirs) {
    if (path === dir || path.startsWith(`${dir}/`)) {
      return "ignored";
    }
  }
  return null;
}

export function buildGitStatusByPath(
  files: GitStatus["files"]
): ReadonlyMap<string, PierFileTreeGitStatus> {
  const byPath = new Map<string, PierFileTreeGitStatus>();
  for (const file of files) {
    const status = gitStatusForCodes(file.index, file.worktree);
    if (!status) {
      continue;
    }
    byPath.set(file.path, status);
    const segments = file.path.split("/");
    segments.pop();
    let ancestor = "";
    for (const segment of segments) {
      ancestor = ancestor.length > 0 ? `${ancestor}/${segment}` : segment;
      const inherited =
        status === "untracked" || status === "added" ? status : "modified";
      const existing = byPath.get(ancestor);
      if (!existing || (existing === "modified" && inherited !== "modified")) {
        byPath.set(ancestor, inherited);
      }
    }
  }
  return byPath;
}
