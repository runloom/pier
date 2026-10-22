import type { FileEntry } from "@shared/contracts/file.ts";

/**
 * 多仓库父目录的仓库边界识别。
 *
 * 用户可以把「装着多个独立仓库的父目录」当项目根打开（例如 `/Users/xyz/XYZ`
 * 下有若干后端 / 前端仓库）。这种根自己没有 `.git`，Git 的忽略规则在根上完全
 * 不成立 —— 于是每个仓库的 `node_modules`、`dist`、构建产物都会进树，条目数从
 * 几千涨到几万。这里把「仓库边界」当作树的一等事实：谁有 `.git`，谁就是仓库根，
 * 它子树内的忽略规则从它自己的 `git ls-files` 来。
 */

/** Git 元数据条目名：工作树里的 `.git` 目录，或 worktree / submodule 的 `.git` 文件。 */
export const GIT_METADATA_NAME = ".git";

const TRAILING_SLASHES_PATTERN = /\/+$/;

/**
 * 一次目录 listing 是否揭示了一个仓库根。
 *
 * 只有 `.git` 是该目录的**直接**子项时才算：更深的 `.git` 属于它自己那次
 * listing，由那一层负责登记。这样发现是惰性的，只跟着用户真正展开的目录走。
 */
export function revealsRepoRoot(
  directoryPath: string,
  entries: readonly FileEntry[]
): boolean {
  const metadataPath = joinRepoDirectory(directoryPath, GIT_METADATA_NAME);
  return entries.some((entry) => entry.path === metadataPath);
}

/** 拼树根相对路径；`parent` 为空时就是 `name` 本身。 */
export function joinRepoDirectory(parent: string, name: string): string {
  return parent.length > 0 ? `${parent}/${name}` : name;
}

/** 把仓库内的相对路径映射成树根相对路径。根仓库（`prefix === ""`）原样返回。 */
export function prefixRepoPath(
  prefix: string,
  repoRelativePath: string
): string {
  return prefix.length > 0 ? `${prefix}/${repoRelativePath}` : repoRelativePath;
}

/** 仓库根前缀 → 可以交给 `git` / `getStatus` 的绝对目录。 */
export function repoDirectoryAbsolute(root: string, prefix: string): string {
  const rootTrimmed = root.replace(TRAILING_SLASHES_PATTERN, "") || "/";
  return prefix.length > 0
    ? `${rootTrimmed === "/" ? "" : rootTrimmed}/${prefix}`
    : rootTrimmed;
}

/** `path` 是否落在某个仓库前缀之内（前缀 `""` 覆盖全部）。 */
export function isPathWithinRepoPrefix(path: string, prefix: string): boolean {
  if (prefix.length === 0) {
    return true;
  }
  return path === prefix || path.startsWith(`${prefix}/`);
}
