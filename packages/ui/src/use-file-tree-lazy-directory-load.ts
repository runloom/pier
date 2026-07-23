import type { useFileTree } from "@pierre/trees/react";
import * as React from "react";
import type { FileTreeRefs } from "./file-tree-internal.ts";
import { isDirectoryHandle } from "./file-tree-model.ts";
import type { PierFileTreeItem } from "./file-tree-types.ts";

type FileTreeModel = ReturnType<typeof useFileTree>["model"];

function directoryHasChildEntries(
  itemsByPath: ReadonlyMap<string, PierFileTreeItem>,
  directoryPath: string
): boolean {
  const prefix = directoryPath.length === 0 ? "" : `${directoryPath}/`;
  const seen = new Set<string>();
  for (const item of itemsByPath.values()) {
    if (seen.has(item.path)) {
      continue;
    }
    seen.add(item.path);
    if (directoryPath.length === 0) {
      if (!item.path.includes("/")) {
        return true;
      }
      continue;
    }
    if (item.path.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Subscribe to tree expansion and request lazy directory loads. Keeps a
 * per-path request gate so stale "loaded" empty stubs and in-flight loads
 * cannot re-fire on every model.subscribe tick.
 */
export function useFileTreeLazyDirectoryLoad(options: {
  activeSearchRef: React.MutableRefObject<string | null>;
  expandedDirectoriesRef: React.MutableRefObject<Map<string, boolean>>;
  model: FileTreeModel;
  readRefs: () => FileTreeRefs;
  requestedLoadDirectoriesRef: React.MutableRefObject<Set<string>>;
}): void {
  const {
    activeSearchRef,
    expandedDirectoriesRef,
    model,
    readRefs,
    requestedLoadDirectoriesRef,
  } = options;

  const syncDirectoryExpansionState = React.useCallback(
    (notifyOnExpand: boolean) => {
      // 搜索展开不是用户意图，不能触发懒加载或覆盖 resetPaths 的显式状态。
      if (activeSearchRef.current != null) {
        return;
      }
      const directoryPaths = readRefs().directoryPaths;
      const loadableDirectoryPaths = readRefs().loadableDirectoryPaths;

      for (const trackedPath of expandedDirectoriesRef.current.keys()) {
        if (!directoryPaths.has(trackedPath)) {
          expandedDirectoriesRef.current.delete(trackedPath);
        }
      }

      // Keep in-flight / unresolved requests across subscribe ticks so stale
      // loaded-empty and repaired unloaded stubs cannot re-fire onLoadDirectory
      // every model update. Clear only when contents arrive or the directory is
      // confirmed empty; a fresh user expand clears the path below.
      for (const requestedPath of requestedLoadDirectoriesRef.current) {
        if (!loadableDirectoryPaths.has(requestedPath)) {
          requestedLoadDirectoriesRef.current.delete(requestedPath);
          continue;
        }
        const callerPath =
          loadableDirectoryPaths.get(requestedPath) ?? requestedPath;
        const state =
          readRefs().directoryLoadStatesByPath.get(requestedPath) ??
          readRefs().directoryLoadStatesByPath.get(callerPath) ??
          "";
        const hasChildren = directoryHasChildEntries(
          readRefs().itemsByPath,
          callerPath
        );
        if (hasChildren || state === "empty") {
          requestedLoadDirectoriesRef.current.delete(requestedPath);
        }
      }

      for (const [officialPath, callerPath] of directoryPaths) {
        const itemHandle = model.getItem(officialPath);
        let isExpanded = false;

        if (isDirectoryHandle(itemHandle)) {
          isExpanded = itemHandle.isExpanded();
        }

        const wasExpanded =
          expandedDirectoriesRef.current.get(officialPath) ?? false;
        expandedDirectoriesRef.current.set(officialPath, isExpanded);
        const newlyExpanded = !wasExpanded && isExpanded;

        if (!(notifyOnExpand && isExpanded)) {
          continue;
        }

        const onLoadDirectory = readRefs().onLoadDirectory;
        const loadState =
          readRefs().directoryLoadStatesByPath.get(officialPath) ??
          readRefs().directoryLoadStatesByPath.get(callerPath) ??
          "";
        // Allow a fresh expand to retry after a settled error; keep the request
        // for in-flight / still-unloaded loads so collapse→expand cannot spam.
        if (newlyExpanded && loadState === "error") {
          requestedLoadDirectoriesRef.current.delete(officialPath);
        }
        const hasChildEntries = directoryHasChildEntries(
          readRefs().itemsByPath,
          callerPath
        );
        // "loaded" with zero children is a stale stub (e.g. old
        // ensureAncestorDirectoryEntries). Re-fetch once while expanded.
        const staleLoadedEmpty = loadState === "loaded" && !hasChildEntries;
        const shouldLoad =
          staleLoadedEmpty ||
          (newlyExpanded &&
            (loadState === "error" || loadState === "unloaded"));

        if (
          !(
            shouldLoad &&
            onLoadDirectory &&
            loadableDirectoryPaths.has(officialPath)
          ) ||
          requestedLoadDirectoriesRef.current.has(officialPath)
        ) {
          continue;
        }

        requestedLoadDirectoriesRef.current.add(officialPath);
        onLoadDirectory(callerPath);
      }
    },
    [
      activeSearchRef,
      expandedDirectoriesRef,
      model,
      readRefs,
      requestedLoadDirectoriesRef,
    ]
  );

  React.useEffect(() => {
    syncDirectoryExpansionState(false);
    return model.subscribe(() => {
      syncDirectoryExpansionState(true);
    });
  }, [model, syncDirectoryExpansionState]);
}
