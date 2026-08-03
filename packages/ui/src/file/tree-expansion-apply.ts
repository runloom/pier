import {
  normalizeExpansionPath,
  type TreeExpansionIntent,
} from "./tree-expansion-authority.ts";
import type { PierDirectoryLoadState, PierFileTreeItem } from "./tree-types.ts";

export type TreeExpansionSeed = "none" | "file-ancestors";

/** Defaults for Expand All (performance-bounded). */
export const EXPAND_ALL_DEFAULT_MAX_DIRECTORY_EXPANDS = 2000;
export const EXPAND_ALL_DEFAULT_MAX_CONCURRENT_LISTS = 8;
/** Absolute path segment depth from repo root (hard safety rail). */
export const EXPAND_ALL_DEFAULT_MAX_DEPTH = 64;
/**
 * How many folder levels to open relative to the expand root.
 * 1 = only the start folder (see its direct children).
 * 3 = start + two nested levels under it.
 */
export const EXPAND_ALL_DEFAULT_MAX_EXPAND_LEVELS = 3;

export function pathSegmentDepth(path: string): number {
  return normalizeExpansionPath(path).split("/").filter(Boolean).length;
}

/**
 * Depth of `path` relative to expand root (0 = the root folder itself).
 * Whole-tree expand uses empty root → relative depth equals path depth.
 */
export function relativeExpandDepth(path: string, rootPath: string): number {
  const normalizedPath = normalizeExpansionPath(path);
  const normalizedRoot = normalizeExpansionPath(rootPath);
  if (normalizedRoot.length === 0) {
    return pathSegmentDepth(normalizedPath);
  }
  if (!isPathUnderRoot(normalizedPath, normalizedRoot)) {
    return Number.POSITIVE_INFINITY;
  }
  return pathSegmentDepth(normalizedPath) - pathSegmentDepth(normalizedRoot);
}

export interface ResolveExpandedPathsOptions {
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>;
  /**
   * When true, propagate expand along single-child directory chains unless
   * the child is explicitly collapsed (compact-folder UX).
   */
  propagateCompactChains?: boolean;
  seed?: TreeExpansionSeed;
}

function stripTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.replace(/\/+$/, "") : path;
}

function directoryLoadStateOf(
  item: PierFileTreeItem,
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>
): PierDirectoryLoadState | undefined {
  if (item.kind !== "directory") {
    return;
  }
  if (item.hasChildren === false) {
    return "empty";
  }
  return (
    directoryStates?.get(item.path) ??
    directoryStates?.get(
      item.path.endsWith("/") ? item.path : `${item.path}/`
    ) ??
    item.loadState
  );
}

function buildChildrenByParent(
  items: readonly PierFileTreeItem[],
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>
): Map<
  string,
  Array<{
    kind: PierFileTreeItem["kind"];
    loadState: PierDirectoryLoadState | undefined;
    path: string;
  }>
> {
  const childrenByParent = new Map<
    string,
    Array<{
      kind: PierFileTreeItem["kind"];
      loadState: PierDirectoryLoadState | undefined;
      path: string;
    }>
  >();
  for (const item of items) {
    const path = stripTrailingSlash(item.path);
    const slash = path.lastIndexOf("/");
    const parent = slash < 0 ? "" : path.slice(0, slash);
    const children = childrenByParent.get(parent) ?? [];
    children.push({
      kind: item.kind,
      loadState: directoryLoadStateOf(item, directoryStates),
      path,
    });
    childrenByParent.set(parent, children);
  }
  return childrenByParent;
}

export function collectKnownDirectoryPaths(
  items: readonly PierFileTreeItem[]
): Set<string> {
  const known = new Set<string>();
  for (const item of items) {
    if (item.kind === "directory") {
      const path = normalizeExpansionPath(item.path);
      if (path.length > 0) {
        known.add(path);
      }
    }
    // Ancestors of any path are directories for expansion purposes.
    const segments = stripTrailingSlash(item.path).split("/").filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      known.add(segments.slice(0, index).join("/"));
    }
    if (item.kind === "directory" && segments.length > 0) {
      known.add(segments.join("/"));
    }
  }
  return known;
}

/** True when `path` is `rootPath` or a descendant of it. Empty root = whole tree. */
export function isPathUnderRoot(path: string, rootPath: string): boolean {
  const normalizedPath = normalizeExpansionPath(path);
  const normalizedRoot = normalizeExpansionPath(rootPath);
  if (normalizedRoot.length === 0) {
    return true;
  }
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

/**
 * Expand All 是否因 user-collapsed 而跳过该目录。
 *
 * - 整树 expand（无 root）：尊重 collapsed，避免一次抹掉用户折叠习惯
 * - 子树 Expand Folders（有 root）：root 范围内一律不跳过——Collapse Folders
 *   会把子孙整树标 collapsed，若 Expand 只开 root 会表现为「只展开第一层」
 */
export function shouldSkipExpandDueToCollapse(options: {
  readonly isUserCollapsed: boolean;
  readonly path: string;
  readonly rootPath: string;
}): boolean {
  if (!options.isUserCollapsed) {
    return false;
  }
  const root = normalizeExpansionPath(options.rootPath);
  if (root.length > 0 && isPathUnderRoot(options.path, root)) {
    return false;
  }
  return true;
}

export function filterPathsUnderRoot(
  paths: Iterable<string>,
  rootPath: string | undefined
): string[] {
  const root = rootPath ? normalizeExpansionPath(rootPath) : "";
  if (root.length === 0) {
    return [...paths].map(normalizeExpansionPath).filter(Boolean);
  }
  return [...paths]
    .map(normalizeExpansionPath)
    .filter((path) => path.length > 0 && isPathUnderRoot(path, root));
}

/**
 * Resolve which directories should be expanded given user intent + seed policy.
 * Priority: collapsed > expanded > seed (no intent) > default collapsed.
 *
 * The seed is a *per-directory* fallback, not a cold-start-only pass: it keeps
 * applying to directories the user has never touched. Gating it on "intent is
 * empty" would make every directory born after the first click default to
 * collapsed — which is what a Git review sees constantly, because staging a
 * file moves it under a different group root and mints brand new paths.
 */
export function resolveExpandedPaths(
  items: readonly PierFileTreeItem[],
  intent: TreeExpansionIntent,
  options: ResolveExpandedPathsOptions = {}
): string[] {
  const seed = options.seed ?? "none";
  const propagateCompactChains = options.propagateCompactChains !== false;
  const knownDirs = collectKnownDirectoryPaths(items);
  const result = new Set<string>();

  for (const path of intent.expanded) {
    if (knownDirs.has(path) && !intent.collapsed.has(path)) {
      result.add(path);
    }
  }

  if (seed === "file-ancestors") {
    for (const item of items) {
      if (item.kind !== "file") {
        continue;
      }
      const segments = stripTrailingSlash(item.path).split("/").filter(Boolean);
      for (let index = 1; index < segments.length; index += 1) {
        const ancestor = segments.slice(0, index).join("/");
        // A collapsed ancestor hides everything below it; stop descending so
        // the user's fold survives refreshes instead of being re-seeded open.
        if (intent.collapsed.has(ancestor)) {
          break;
        }
        result.add(ancestor);
      }
    }
  }

  if (propagateCompactChains) {
    const childrenByParent = buildChildrenByParent(
      items,
      options.directoryStates
    );
    for (const headPath of [...result]) {
      let currentPath = headPath;
      while (true) {
        const children = childrenByParent.get(currentPath);
        const onlyChild = children?.length === 1 ? children[0] : undefined;
        if (
          onlyChild?.kind !== "directory" ||
          onlyChild.loadState === "error"
        ) {
          break;
        }
        if (intent.collapsed.has(onlyChild.path)) {
          break;
        }
        result.add(onlyChild.path);
        currentPath = onlyChild.path;
      }
    }
  }

  for (const path of intent.collapsed) {
    result.delete(path);
  }

  return [...result];
}

/**
 * Bridge legacy Map<path, boolean> expansion snapshots into intent resolution.
 * Used only while migrating callers off expandedDirectoriesRef authority.
 */
export function intentFromExpansionMap(
  expansionByPath: ReadonlyMap<string, boolean>
): TreeExpansionIntent {
  const expanded = new Set<string>();
  const collapsed = new Set<string>();
  for (const [path, isExpanded] of expansionByPath) {
    const normalized = normalizeExpansionPath(path);
    if (normalized.length === 0) {
      continue;
    }
    if (isExpanded) {
      expanded.add(normalized);
    } else {
      collapsed.add(normalized);
    }
  }
  return { collapsed, expanded };
}

/**
 * Convert intent + optional model snapshot Map into expanded path list for
 * resetPaths, matching previous collectPreservedExpandedDirectoryPaths behavior
 * when the map is the sole source of truth.
 */
export function collectPreservedExpandedDirectoryPathsFromIntent(
  items: readonly PierFileTreeItem[],
  intent: TreeExpansionIntent,
  directoryStates?: ReadonlyMap<string, PierDirectoryLoadState>,
  seed: TreeExpansionSeed = "none"
): string[] {
  return resolveExpandedPaths(items, intent, {
    ...(directoryStates === undefined ? {} : { directoryStates }),
    propagateCompactChains: true,
    seed,
  });
}
