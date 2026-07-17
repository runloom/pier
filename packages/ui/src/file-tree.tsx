import type {
  FileTreeSelectionChangeListener,
  GitStatusEntry,
} from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import * as React from "react";
import {
  fileTreeContextMenuOption,
  itemsToGitStatusEntries,
} from "./file-tree-internal.ts";
import {
  collectExpandedDirectoryPaths,
  isDirectoryHandle,
  stripTrailingSlash,
  toOfficialDecoration,
  toOfficialPath,
  treeRenderSignature,
} from "./file-tree-model.ts";
import { FileTreeRenameSession } from "./file-tree-rename-session.ts";
import { usePierFileTreeScrollController } from "./file-tree-scroll-controller.ts";
import * as treeSearch from "./file-tree-search.ts";
import { pierFileTreeStyle, TREE_SCROLLBAR_CSS } from "./file-tree-style.ts";
import type { PierFileTreeProps } from "./file-tree-types.ts";
import {
  fileTreeDragAndDropConfig,
  fileTreeRenamingConfig,
} from "./file-tree-write-options.ts";
import { useFileTreeContextMenuComposition } from "./use-file-tree-context-menu.ts";
import { useFileTreePathSync } from "./use-file-tree-path-sync.ts";
import { useFileTreeRefs } from "./use-file-tree-refs.ts";
import { cn } from "./utils.ts";

export type {
  PierDirectoryLoadState,
  PierFileTreeApi,
  PierFileTreeContextMenuItem,
  PierFileTreeContextMenuPoint,
  PierFileTreeGitStatus,
  PierFileTreeItem,
  PierFileTreeMove,
  PierFileTreeProps,
  PierFileTreeScrollController,
  PierFileTreeScrollRestoreOptions,
  PierFileTreeScrollSnapshot,
} from "./file-tree-types.ts";

export function PierFileTree({
  directoryErrorLabel,
  directoryStates,
  items,
  label,
  onLoadDirectory,
  onModelPathsRemoved,
  onMovePaths,
  onOpenItemContextMenu,
  onOpenPath,
  onRenamePath,
  onSearchMatchStateChange,
  onScrollSnapshotChange,
  onSelectPaths,
  revealPath,
  scrollControllerRef,
  stickyFolders,
  treeApiRef,
  className,
  style,
  ...props
}: PierFileTreeProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const expandedDirectoriesRef = React.useRef(new Map<string, boolean>());
  const requestedLoadDirectoriesRef = React.useRef(new Set<string>());
  const paths = React.useMemo(() => items.map(toOfficialPath), [items]);
  const renderSignature = React.useMemo(
    () => treeRenderSignature(items, directoryStates),
    [directoryStates, items]
  );
  const gitStatus = React.useMemo<GitStatusEntry[]>(
    () => itemsToGitStatusEntries(items),
    [items]
  );
  const initialExpandedPaths = React.useMemo(
    () => collectExpandedDirectoryPaths(items, directoryStates),
    [directoryStates, items]
  );

  const { nextRefs, readRefs, refs } = useFileTreeRefs({
    directoryErrorLabel,
    directoryStates,
    items,
    onLoadDirectory,
    onModelPathsRemoved,
    onMovePaths,
    onOpenItemContextMenu,
    onOpenPath,
    onRenamePath,
    onSelectPaths,
  });

  const fileTreeStyle = React.useMemo(() => pierFileTreeStyle(style), [style]);
  const programmaticSelectionRef = React.useRef<{ path: string } | null>(null);
  const lastOpenedPathRef = React.useRef<string | null>(null);

  const handleSelectionChange =
    React.useCallback<FileTreeSelectionChangeListener>(
      (selectedPaths) => {
        const nextSelectedPaths = [...selectedPaths];
        const selectedPath = nextSelectedPaths.at(-1);
        const suppressOpenPath =
          selectedPath != null &&
          programmaticSelectionRef.current?.path === selectedPath;
        programmaticSelectionRef.current = null;
        const selectedItem =
          selectedPath == null
            ? undefined
            : readRefs().itemsByPath.get(selectedPath);
        const outwardSelectedPaths = nextSelectedPaths.map(
          (path) => readRefs().itemsByPath.get(path)?.path ?? path
        );

        readRefs().onSelectPaths?.(outwardSelectedPaths);

        if (selectedItem?.kind === "file" && !suppressOpenPath) {
          lastOpenedPathRef.current = selectedItem.path;
          readRefs().onOpenPath?.(selectedItem.path);
        }
      },
      [readRefs]
    );
  const handleHostClickCapture = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Pierre trees 对已选中行再点不会 bump selectionVersion。
      // 捕获阶段对文件行统一补一次 onOpenPath，覆盖 re-click 重新定位。
      if (event.button !== 0) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const row = target.closest<HTMLElement>("[data-item-path]");
      if (!row || row.dataset.itemType === "folder") {
        return;
      }
      const officialPath = row.dataset.itemPath;
      if (!officialPath) {
        return;
      }
      const item = readRefs().itemsByPath.get(officialPath);
      if (item?.kind !== "file") {
        return;
      }
      lastOpenedPathRef.current = item.path;
      readRefs().onOpenPath?.(item.path);
    },
    [readRefs]
  );

  const modelAheadMovesRef = React.useRef(new Map<string, string>());
  const renameSession = React.useMemo(() => new FileTreeRenameSession(), []);

  const { model } = useFileTree({
    ...fileTreeContextMenuOption(onOpenItemContextMenu != null, refs),
    density: "compact",
    unsafeCSS: TREE_SCROLLBAR_CSS,
    // 只读调用方不配置模型写能力；Files 传入回调时才开启官方拖拽。
    ...(onMovePaths
      ? { dragAndDrop: fileTreeDragAndDropConfig(readRefs) }
      : {}),
    flattenEmptyDirectories: true,
    gitStatus,
    initialExpandedPaths,
    onSelectionChange: handleSelectionChange,
    paths,
    ...(onRenamePath
      ? {
          renaming: fileTreeRenamingConfig(
            readRefs,
            modelAheadMovesRef,
            renameSession.deliveryRef
          ),
        }
      : {}),
    // 搜索走 setSearch 编程驱动 + 业务层自绘搜索栏;不渲染库内置搜索头。
    fileTreeSearchMode: "hide-non-matches",
    renderRowDecoration: ({ item }) =>
      toOfficialDecoration(readRefs().decorationsByPath.get(item.path)),
    ...(stickyFolders ? { stickyFolders: true } : {}),
  });
  React.useEffect(() => () => renameSession.dispose(), [renameSession]);
  useFileTreeContextMenuComposition(model, onOpenItemContextMenu != null, refs);
  treeSearch.useSearchMatchState(model, nextRefs, onSearchMatchStateChange);
  const activeSearchRef = React.useRef<string | null>(null);
  React.useImperativeHandle(
    treeApiRef,
    () => ({
      activateFocusedSearchMatch: () =>
        treeSearch.activateFocusedMatch(model, readRefs()),
      focusSearchMatch: (direction) => {
        if (direction === "next") {
          model.focusNextSearchMatch();
        } else {
          model.focusPreviousSearchMatch();
        }
      },
      getSearchMatchCount: () => model.getSearchMatchingPaths().length,
      setSearch: (searchValue) => {
        // 记录激活中的查询:resetPaths(store 重建)会让库内搜索派生投影
        // (#searchVisiblePathSet 等)与新 store 脱节,路径同步 effect 需要
        // 先清后重放(见下方 resetPaths 分支)。
        activeSearchRef.current =
          searchValue != null && searchValue.length > 0 ? searchValue : null;
        model.setSearch(searchValue);
      },
      revealPath: (path) => {
        const segments = path.split("/").filter(Boolean);
        // 逐级展开祖先目录,再滚动定位目标本身。
        for (let index = 1; index < segments.length; index += 1) {
          const ancestorPath = segments.slice(0, index).join("/");
          const ancestorItem = readRefs().itemsByPath.get(ancestorPath);
          if (!ancestorItem) {
            continue;
          }
          const handle = model.getItem(toOfficialPath(ancestorItem));
          if (isDirectoryHandle(handle) && !handle.isExpanded()) {
            handle.expand();
          }
        }
        const item = readRefs().itemsByPath.get(path);
        const officialPath = item ? toOfficialPath(item) : path;
        try {
          model.scrollToPath(officialPath, {
            focus: false,
            offset: "nearest",
          });
          model.focusPath(officialPath);
        } catch {
          // 目标尚未加载(懒加载目录):祖先已展开,子层加载后用户可见。
        }
      },
      removePaths: (pathsToRemove) => {
        for (const path of pathsToRemove) {
          const item = readRefs().itemsByPath.get(path);
          const officialPath = item ? toOfficialPath(item) : path;
          const directory =
            item?.kind === "directory" || officialPath.endsWith("/");
          try {
            model.remove(
              officialPath,
              directory ? { recursive: true } : undefined
            );
          } catch {
            // 路径已不在模型中:忽略。
          }
        }
      },
      startRenaming: (path, options) => {
        if (!readRefs().onRenamePath) {
          return false;
        }
        const item = readRefs().itemsByPath.get(path);
        const officialPath = item ? toOfficialPath(item) : path;
        const callerPath = item?.path ?? stripTrailingSlash(path);
        const removeIfCanceled = options?.removeIfCanceled === true;
        const started = model.startRenaming(
          officialPath,
          removeIfCanceled ? { removeIfCanceled: true } : undefined
        );
        if (!(started && removeIfCanceled)) {
          return started;
        }
        // 库在 basename 未改时不调 onRename;新建占位确认默认名需要补一次回调。
        // Esc/空提交走 removeIfCanceled → onMutation(remove) → onModelPathsRemoved。
        renameSession.begin({
          callerPath,
          isFolder: item?.kind === "directory",
          model,
          officialPath,
          readRefs,
        });
        return started;
      },
    }),
    [model, readRefs, renameSession]
  );

  // active 文件变化时定位并选中；model 选中不会触发用户路径的 onOpenPath。
  const lastRevealRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!revealPath || revealPath === lastRevealRef.current) {
      if (!revealPath) {
        lastRevealRef.current = null;
      }
      return;
    }
    const item = readRefs().itemsByPath.get(revealPath);
    if (!item) {
      return;
    }
    lastRevealRef.current = revealPath;
    const officialPath = toOfficialPath(item);
    try {
      model.scrollToPath(officialPath, { focus: false, offset: "nearest" });
      model.focusPath(officialPath);
      const programmaticSelection = { path: officialPath };
      programmaticSelectionRef.current = programmaticSelection;
      try {
        model.selectOnlyPath(officialPath);
      } finally {
        queueMicrotask(() => {
          if (programmaticSelectionRef.current === programmaticSelection) {
            programmaticSelectionRef.current = null;
          }
        });
      }
    } catch {
      // 路径尚未在可见投影中(父目录未展开):静默忽略,下一次 items 变化重试。
      lastRevealRef.current = null;
    }
  }, [model, readRefs, revealPath]);

  React.useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [gitStatus, model]);

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

      for (const requestedPath of requestedLoadDirectoriesRef.current) {
        if (
          !loadableDirectoryPaths.has(requestedPath) ||
          readRefs().directoryLoadStatesByPath.get(requestedPath) !== "unloaded"
        ) {
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

        if (!(notifyOnExpand && isExpanded) || wasExpanded) {
          continue;
        }

        const onLoadDirectory = readRefs().onLoadDirectory;

        if (
          onLoadDirectory == null ||
          !loadableDirectoryPaths.has(officialPath) ||
          !["error", "unloaded"].includes(
            readRefs().directoryLoadStatesByPath.get(officialPath) ?? ""
          ) ||
          requestedLoadDirectoriesRef.current.has(officialPath)
        ) {
          continue;
        }

        requestedLoadDirectoriesRef.current.add(officialPath);
        onLoadDirectory(callerPath);
      }
    },
    [model, readRefs]
  );

  React.useEffect(() => {
    syncDirectoryExpansionState(false);
    return model.subscribe(() => {
      syncDirectoryExpansionState(true);
    });
  }, [model, syncDirectoryExpansionState]);

  const { captureSnapshot, restoreSnapshotSoon } =
    usePierFileTreeScrollController({
      containerRef,
      onScrollSnapshotChange,
      scrollControllerRef,
    });

  useFileTreePathSync({
    activeSearchRef,
    captureSnapshot,
    directoryStates,
    expandedDirectoriesRef,
    items,
    model,
    modelAheadMovesRef,
    paths,
    renderSignature,
    restoreSnapshotSoon,
  });

  return (
    <div
      className={cn("h-full min-h-0 w-full", className)}
      data-slot="pier-file-tree-bridge"
      onClickCapture={handleHostClickCapture}
      ref={containerRef}
    >
      <PierreFileTree
        {...props}
        aria-label={label}
        className="h-full min-h-0 w-full"
        data-slot="pier-file-tree"
        model={model}
        style={fileTreeStyle}
      />
    </div>
  );
}
