/**
 * Persist Files tree expansion intents per project root (localStorage).
 * Storage mechanics live in `@pier/ui/file/tree-expansion-persist.ts`; this
 * module only owns the Files-specific key space.
 */

import type { TreeExpansionAuthority } from "@pier/ui/file/tree.tsx";
import { pathSegmentDepth } from "@pier/ui/file/tree-expansion-apply.ts";
import { normalizeExpansionPath } from "@pier/ui/file/tree-expansion-authority.ts";
import {
  bindTreeExpansionPersistence,
  hydrateTreeExpansion,
  readTreeExpansion,
  writeTreeExpansion,
} from "@pier/ui/file/tree-expansion-persist.ts";

const STORAGE_PREFIX = "pier.files.tree.expansion.v1:";
/** 冷启动只预取靠近根的路径；落盘仍可到 500。其余首帧后懒加载。 */
export const FILES_TREE_RESTORE_EXPAND_MAX_PATHS = 64;

function storageKey(projectRoot: string): string {
  return STORAGE_PREFIX.concat(projectRoot);
}

export function readFilesTreeExpansion(projectRoot: string): unknown {
  return readTreeExpansion(storageKey(projectRoot));
}

/** 同步灌回该项目根的展开意图，供首帧树使用。 */
export function hydrateFilesTreeExpansion(
  projectRoot: string,
  authority: TreeExpansionAuthority
): boolean {
  return hydrateTreeExpansion(storageKey(projectRoot), authority);
}

function stringPathSet(raw: unknown): Set<string> {
  const paths = new Set<string>();
  if (!Array.isArray(raw)) {
    return paths;
  }
  for (const value of raw) {
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }
    const path = normalizeExpansionPath(value);
    if (path.length > 0) {
      paths.add(path);
    }
  }
  return paths;
}

function ancestorDirectoryPaths(path: string): string[] {
  const segments = normalizeExpansionPath(path).split("/").filter(Boolean);
  const ancestors: string[] = [];
  for (let index = 1; index <= segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

function isCollapsedOrUnderCollapsed(
  path: string,
  collapsed: ReadonlySet<string>
): boolean {
  for (const ancestor of ancestorDirectoryPaths(path)) {
    if (collapsed.has(ancestor)) {
      return true;
    }
  }
  return false;
}

function sortShallowFirst(paths: readonly string[]): string[] {
  return [...paths].sort(
    (left, right) =>
      pathSegmentDepth(left) - pathSegmentDepth(right) ||
      left.localeCompare(right)
  );
}

/** 落盘里记住的展开目录（浅路径优先）。 */
export function readFilesTreeExpandedPaths(projectRoot: string): string[] {
  const data = readFilesTreeExpansion(projectRoot);
  if (data == null || typeof data !== "object") {
    return [];
  }
  const record = data as Record<string, unknown>;
  if (record.v !== 1) {
    return [];
  }
  return sortShallowFirst([...stringPathSet(record.expanded)]);
}

/**
 * 冷启动预取目标：expanded − collapsed（含祖先闭包）∩ 当前根可见目录。
 * 顶层不在这次 root listing 里的路径跳过，留给懒加载。
 */
export function collectFilesTreeRestoreDirectoryPaths(
  projectRoot: string,
  options: {
    hasRootLevelDirectory: (name: string) => boolean;
    isVisible: (path: string) => boolean;
    maxPaths?: number;
  }
): string[] {
  const data = readFilesTreeExpansion(projectRoot);
  if (data == null || typeof data !== "object") {
    return [];
  }
  const record = data as Record<string, unknown>;
  if (record.v !== 1) {
    return [];
  }
  const collapsed = stringPathSet(record.collapsed);
  const expanded = stringPathSet(record.expanded);
  const candidates = new Set<string>();
  for (const path of expanded) {
    if (isCollapsedOrUnderCollapsed(path, collapsed)) {
      continue;
    }
    for (const ancestor of ancestorDirectoryPaths(path)) {
      if (isCollapsedOrUnderCollapsed(ancestor, collapsed)) {
        break;
      }
      if (!options.isVisible(ancestor)) {
        break;
      }
      const top = ancestor.split("/").filter(Boolean)[0];
      if (top === undefined || !options.hasRootLevelDirectory(top)) {
        break;
      }
      candidates.add(ancestor);
    }
  }
  return sortShallowFirst([...candidates]).slice(
    0,
    options.maxPaths ?? FILES_TREE_RESTORE_EXPAND_MAX_PATHS
  );
}

export function writeFilesTreeExpansion(
  projectRoot: string,
  authority: TreeExpansionAuthority
): void {
  writeTreeExpansion(storageKey(projectRoot), authority);
}

export function bindFilesTreeExpansionPersistence(
  projectRoot: string,
  authority: TreeExpansionAuthority
): () => void {
  return bindTreeExpansionPersistence(storageKey(projectRoot), authority);
}
