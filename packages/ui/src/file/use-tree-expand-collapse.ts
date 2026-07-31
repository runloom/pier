import type { useFileTree } from "@pierre/trees/react";
import * as React from "react";
import {
  collectKnownDirectoryPaths,
  EXPAND_ALL_DEFAULT_MAX_CONCURRENT_LISTS,
  EXPAND_ALL_DEFAULT_MAX_DEPTH,
  EXPAND_ALL_DEFAULT_MAX_DIRECTORY_EXPANDS,
  EXPAND_ALL_DEFAULT_MAX_EXPAND_LEVELS,
  filterPathsUnderRoot,
  isPathUnderRoot,
  pathSegmentDepth,
  relativeExpandDepth,
  resolveExpandedPaths,
} from "./tree-expansion-apply.ts";
import type { TreeExpansionAuthority } from "./tree-expansion-authority.ts";
import { normalizeExpansionPath } from "./tree-expansion-authority.ts";
import type { FileTreeRefs } from "./tree-internal.ts";
import { isDirectoryHandle, stripTrailingSlash } from "./tree-model.ts";
import type {
  PierDirectoryLoadState,
  PierFileTreeCollapseAllOptions,
  PierFileTreeExpandAllOptions,
  PierFileTreeItem,
} from "./tree-types.ts";

type FileTreeModel = ReturnType<typeof useFileTree>["model"];

export type ApplyDirectoryExpansionMode =
  | "set"
  | "expand-only"
  | "collapse-only";

/**
 * Expand / collapse APIs + authority re-assert after lazy loads (compact chains).
 */
export function useFileTreeExpandCollapse(options: {
  activeSearchRef: React.MutableRefObject<string | null>;
  directoryStates: ReadonlyMap<string, PierDirectoryLoadState> | undefined;
  directoryStatesRef: React.MutableRefObject<
    ReadonlyMap<string, PierDirectoryLoadState> | undefined
  >;
  expandAllGenerationRef: React.MutableRefObject<number>;
  expandedDirectoriesRef: React.MutableRefObject<Map<string, boolean>>;
  expansionAuthority?: TreeExpansionAuthority | undefined;
  items: readonly PierFileTreeItem[];
  itemsRef: React.MutableRefObject<readonly PierFileTreeItem[]>;
  model: FileTreeModel;
  readRefs: () => FileTreeRefs;
  renderSignature: string;
  suppressAuthorityWriteRef: React.MutableRefObject<boolean>;
}): {
  applyDirectoryExpansion: (
    desired: ReadonlySet<string>,
    mode?: ApplyDirectoryExpansionMode
  ) => void;
  collapseAllDirectories: (options?: PierFileTreeCollapseAllOptions) => void;
  expandAllDirectories: (options?: PierFileTreeExpandAllOptions) => void;
} {
  const {
    activeSearchRef,
    directoryStates,
    directoryStatesRef,
    expandAllGenerationRef,
    expandedDirectoriesRef,
    expansionAuthority,
    items,
    itemsRef,
    model,
    readRefs,
    renderSignature,
    suppressAuthorityWriteRef,
  } = options;

  /**
   * mode "set": expand exactly `desired`, collapse everything else (whole-tree).
   * mode "expand-only": expand members of `desired`, never collapse others
   *   (subtree Expand All must not close sibling folders like `src`).
   * mode "collapse-only": collapse members of `desired`, leave others alone.
   */
  const applyDirectoryExpansion = React.useCallback(
    (
      desired: ReadonlySet<string>,
      mode: ApplyDirectoryExpansionMode = "set"
    ) => {
      suppressAuthorityWriteRef.current = true;
      try {
        for (const [officialPath, callerPath] of readRefs().directoryPaths) {
          const handle = model.getItem(officialPath);
          if (!isDirectoryHandle(handle)) {
            continue;
          }
          const key = normalizeExpansionPath(stripTrailingSlash(callerPath));
          const inDesired = desired.has(key);
          if (mode === "expand-only") {
            // Expand the model row, but do NOT pre-mark expandedDirectoriesRef.
            // Pre-marking makes lazy-load think the node was already open
            // (newlyExpanded=false) and skip listing → open chevron, no children.
            if (inDesired && !handle.isExpanded()) {
              handle.expand();
            }
            continue;
          }
          if (mode === "collapse-only") {
            if (inDesired && handle.isExpanded()) {
              handle.collapse();
            }
            if (inDesired) {
              expandedDirectoriesRef.current.set(officialPath, false);
            }
            continue;
          }
          if (inDesired && !handle.isExpanded()) {
            handle.expand();
          } else if (!inDesired && handle.isExpanded()) {
            handle.collapse();
          }
          expandedDirectoriesRef.current.set(officialPath, inDesired);
        }
      } finally {
        queueMicrotask(() => {
          suppressAuthorityWriteRef.current = false;
        });
      }
    },
    [expandedDirectoriesRef, model, readRefs, suppressAuthorityWriteRef]
  );

  const collapseAllDirectories = React.useCallback(
    (collapseOptions?: PierFileTreeCollapseAllOptions) => {
      // Cancel any in-flight Expand All.
      expandAllGenerationRef.current += 1;
      if (activeSearchRef.current != null) {
        activeSearchRef.current = null;
        model.setSearch(null);
      }
      const rootPath = collapseOptions?.rootPath
        ? normalizeExpansionPath(collapseOptions.rootPath)
        : "";
      const known = collectKnownDirectoryPaths(itemsRef.current);
      const scoped = filterPathsUnderRoot(known, rootPath || undefined);

      if (rootPath.length === 0) {
        if (expansionAuthority) {
          expansionAuthority.collapseAll(known, "api");
        }
        applyDirectoryExpansion(new Set(), "set");
        return;
      }

      // Subtree: collapse root + descendants only; leave siblings (e.g. src) alone.
      if (expansionAuthority) {
        for (const path of scoped) {
          expansionAuthority.setDirectoryExpanded(path, false, "api");
        }
      }
      applyDirectoryExpansion(new Set(scoped), "collapse-only");
    },
    [
      activeSearchRef,
      applyDirectoryExpansion,
      expandAllGenerationRef,
      expansionAuthority,
      itemsRef,
      model,
    ]
  );

  const expandAllDirectories = React.useCallback(
    (expandOptions?: PierFileTreeExpandAllOptions) => {
      const recursive = expandOptions?.recursive !== false;
      const maxDirectoryExpands =
        expandOptions?.maxDirectoryExpands ??
        EXPAND_ALL_DEFAULT_MAX_DIRECTORY_EXPANDS;
      const maxConcurrentLists =
        expandOptions?.maxConcurrentLists ??
        EXPAND_ALL_DEFAULT_MAX_CONCURRENT_LISTS;
      const maxDepth = expandOptions?.maxDepth ?? EXPAND_ALL_DEFAULT_MAX_DEPTH;
      const maxExpandLevels =
        expandOptions?.maxExpandLevels ?? EXPAND_ALL_DEFAULT_MAX_EXPAND_LEVELS;
      const rootPath = expandOptions?.rootPath
        ? normalizeExpansionPath(expandOptions.rootPath)
        : "";
      expandAllGenerationRef.current += 1;
      const generation = expandAllGenerationRef.current;

      if (activeSearchRef.current != null) {
        activeSearchRef.current = null;
        model.setSearch(null);
      }

      // Subtree: relative depth 0..maxExpandLevels-1 (start + nested levels).
      // Whole-tree: path segment depth 1..maxExpandLevels so top-level folders
      // get the same nested budget as a folder-scoped Expand Folders.
      const withinExpandLevels = (path: string): boolean => {
        if (rootPath.length === 0) {
          return pathSegmentDepth(path) <= maxExpandLevels;
        }
        return relativeExpandDepth(path, rootPath) < maxExpandLevels;
      };

      const isUserCollapsed = (path: string): boolean =>
        expansionAuthority
          ?.getIntent()
          .collapsed.has(normalizeExpansionPath(path)) === true;

      const expandDesiredFromVisited = (
        visited: ReadonlySet<string>
      ): Set<string> => {
        const desired = new Set<string>();
        for (const path of visited) {
          if (!isUserCollapsed(path)) {
            desired.add(path);
          }
        }
        return desired;
      };

      const hasProjectedChildren = (path: string): boolean => {
        const prefix = `${path}/`;
        return itemsRef.current.some(
          (candidate) =>
            candidate.path.startsWith(prefix) && candidate.path !== path
        );
      };

      const needsLoad = (path: string): boolean => {
        const item = itemsRef.current.find(
          (candidate) => candidate.path === path
        );
        if (item?.kind === "directory" && item.hasChildren === false) {
          return false;
        }
        if (hasProjectedChildren(path)) {
          return false;
        }
        const state = directoryStatesRef.current?.get(path) ?? item?.loadState;
        // Confirmed empty after list — leave as expanded empty.
        if (state === "empty") {
          return false;
        }
        if (state === "loading") {
          return true;
        }
        // unloaded / error / loaded-without-children stub / unknown → list.
        return true;
      };

      const waitForPaint = (): Promise<void> =>
        new Promise((resolve) => {
          if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => resolve());
            });
            return;
          }
          setTimeout(resolve, 0);
        });

      const runExpandAll = async (): Promise<void> => {
        const visited = new Set<string>();
        let expandCount = 0;

        // Subtree expand always starts by expanding the root folder itself.
        if (rootPath.length > 0 && !isUserCollapsed(rootPath)) {
          visited.add(rootPath);
          if (expansionAuthority) {
            expansionAuthority.setDirectoryExpanded(rootPath, true, "api");
          }
          applyDirectoryExpansion(
            expandDesiredFromVisited(new Set([rootPath])),
            "expand-only"
          );
          expandCount += 1;
          if (needsLoad(rootPath)) {
            const onLoadDirectory = readRefs().onLoadDirectory;
            if (onLoadDirectory) {
              try {
                await onLoadDirectory(rootPath);
              } catch {
                // Keep going; empty/error dirs stop naturally.
              }
              await waitForPaint();
            }
          }
        }

        while (
          expandCount < maxDirectoryExpands &&
          expandAllGenerationRef.current === generation
        ) {
          const known = collectKnownDirectoryPaths(itemsRef.current);
          const candidates: string[] = [];
          for (const path of known) {
            if (visited.has(path) || isUserCollapsed(path)) {
              continue;
            }
            if (rootPath.length > 0 && !isPathUnderRoot(path, rootPath)) {
              continue;
            }
            if (!withinExpandLevels(path)) {
              continue;
            }
            // Absolute depth hard rail (repo-root segment count).
            if (relativeExpandDepth(path, "") > maxDepth) {
              continue;
            }
            candidates.push(path);
          }
          if (candidates.length === 0) {
            break;
          }

          const remaining = maxDirectoryExpands - expandCount;
          const wave = candidates.slice(0, remaining);
          for (const path of wave) {
            visited.add(path);
          }
          expandCount += wave.length;

          if (expansionAuthority) {
            // expandPaths clears collapsed — only pass still-desired paths.
            expansionAuthority.expandPaths(
              wave.filter((path) => !isUserCollapsed(path)),
              "api"
            );
          }

          // expand-only: do NOT collapse siblings (e.g. right-click .husky must
          // not close an open `src`). Never re-open user-collapsed dirs.
          applyDirectoryExpansion(
            expandDesiredFromVisited(visited),
            "expand-only"
          );

          if (!recursive) {
            break;
          }

          const toLoad = wave.filter(
            (path) => !isUserCollapsed(path) && needsLoad(path)
          );
          const onLoadDirectory = readRefs().onLoadDirectory;
          if (toLoad.length > 0 && onLoadDirectory) {
            for (
              let offset = 0;
              offset < toLoad.length;
              offset += maxConcurrentLists
            ) {
              if (expandAllGenerationRef.current !== generation) {
                return;
              }
              const chunk = toLoad.slice(offset, offset + maxConcurrentLists);
              await Promise.all(
                chunk.map(async (path) => {
                  try {
                    await onLoadDirectory(path);
                  } catch {
                    // Load errors surface via directory state; keep Expand All going.
                  }
                })
              );
              await waitForPaint();
              // Children just arrived in the store/model — re-assert expansion so
              // rows with open chevrons actually show their contents.
              applyDirectoryExpansion(
                expandDesiredFromVisited(visited),
                "expand-only"
              );
            }
          } else if (wave.length === candidates.length) {
            break;
          } else {
            await waitForPaint();
            applyDirectoryExpansion(
              expandDesiredFromVisited(visited),
              "expand-only"
            );
          }
        }
      };

      runExpandAll().catch(() => undefined);
    },
    [
      activeSearchRef,
      applyDirectoryExpansion,
      directoryStatesRef,
      expandAllGenerationRef,
      expansionAuthority,
      itemsRef,
      model,
      readRefs,
    ]
  );

  // After lazy loads add children (esp. compact single-child chains), re-assert
  // authority expansion so the first expand shows content, not an empty shell.
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderSignature re-runs after path/load projection changes without items identity churn.
  React.useEffect(() => {
    if (!expansionAuthority || activeSearchRef.current != null) {
      return;
    }
    const intent = expansionAuthority.getIntent();
    if (intent.expanded.size === 0) {
      return;
    }
    const desired = new Set(
      resolveExpandedPaths(items, intent, {
        ...(directoryStates === undefined ? {} : { directoryStates }),
        propagateCompactChains: true,
        seed: "none",
      })
    );
    if (desired.size === 0) {
      return;
    }
    // Skip no-op: only expand-only when at least one desired dir is still closed.
    let needsExpand = false;
    for (const [officialPath, callerPath] of readRefs().directoryPaths) {
      const key = normalizeExpansionPath(stripTrailingSlash(callerPath));
      if (!desired.has(key)) {
        continue;
      }
      const handle = model.getItem(officialPath);
      if (isDirectoryHandle(handle) && !handle.isExpanded()) {
        needsExpand = true;
        break;
      }
    }
    if (!needsExpand) {
      return;
    }
    applyDirectoryExpansion(desired, "expand-only");
  }, [
    activeSearchRef,
    applyDirectoryExpansion,
    directoryStates,
    expansionAuthority,
    items,
    model,
    readRefs,
    renderSignature,
  ]);

  return {
    applyDirectoryExpansion,
    collapseAllDirectories,
    expandAllDirectories,
  };
}
