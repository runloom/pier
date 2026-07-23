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
  stripTrailingSlash,
  toOfficialDecoration,
  toOfficialPath,
  treeRenderSignature,
} from "./file-tree-model.ts";
import { FileTreeRenameSession } from "./file-tree-rename-session.ts";
import { revealFileTreePath } from "./file-tree-reveal.ts";
import { usePierFileTreeScrollController } from "./file-tree-scroll-controller.ts";
import * as treeSearch from "./file-tree-search.ts";
import { pierFileTreeStyle, TREE_SCROLLBAR_CSS } from "./file-tree-style.ts";
import type {
  PierFileTreeProps,
  PierFileTreeRevealOptions,
} from "./file-tree-types.ts";
import {
  fileTreeDragAndDropConfig,
  fileTreeRenamingConfig,
} from "./file-tree-write-options.ts";
import { useFileTreeContextMenuComposition } from "./use-file-tree-context-menu.ts";
import { useFileTreeLazyDirectoryLoad } from "./use-file-tree-lazy-directory-load.ts";
import { useFileTreePathSync } from "./use-file-tree-path-sync.ts";
import { useFileTreeRefs } from "./use-file-tree-refs.ts";
import { useFileTreeRowClickSalvage } from "./use-file-tree-row-click-salvage.ts";
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
  PierFileTreeRevealOptions,
  PierFileTreeRevealScroll,
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
  const rowClickSalvage = useFileTreeRowClickSalvage({
    containerRef,
    lastOpenedPathRef,
    model,
    readRefs,
  });

  React.useEffect(() => () => renameSession.dispose(), [renameSession]);
  useFileTreeContextMenuComposition(model, onOpenItemContextMenu != null, refs);
  treeSearch.useSearchMatchState(model, nextRefs, onSearchMatchStateChange);
  const activeSearchRef = React.useRef<string | null>(null);
  const pendingRevealRef = React.useRef<{
    options: PierFileTreeRevealOptions;
    path: string;
  } | null>(null);
  // Explicit API/breadcrumb reveal must win over the active-file prop until the
  // active path itself changes (otherwise expand/load churn re-asserts the file).
  const suppressActiveRevealRef = React.useRef(false);

  const runReveal = React.useCallback(
    (path: string, options?: PierFileTreeRevealOptions): boolean =>
      revealFileTreePath(
        {
          focusNearestPath: (candidate) => model.focusNearestPath(candidate),
          focusPath: (candidate) => {
            model.focusPath(candidate);
          },
          getFileTreeContainer: () =>
            containerRef.current?.querySelector("file-tree-container") ??
            undefined,
          getItem: (candidate) => model.getItem(candidate),
          getSelectedPaths: () => model.getSelectedPaths(),
          scrollToPath: (candidate, scrollOptions) => {
            model.scrollToPath(candidate, scrollOptions);
          },
          selectOnlyPath: (candidate) => {
            model.selectOnlyPath(candidate);
          },
        },
        readRefs,
        programmaticSelectionRef,
        path,
        options
      ),
    [model, readRefs]
  );

  const requestReveal = React.useCallback(
    (path: string, options?: PierFileTreeRevealOptions) => {
      const nextOptions: PierFileTreeRevealOptions = {
        expandTarget: true,
        scroll: "center",
        ...options,
      };
      pendingRevealRef.current = {
        options: nextOptions,
        path,
      };
      if (runReveal(path, nextOptions)) {
        pendingRevealRef.current = null;
        return;
      }
      // Expand/lazy-load can leave the row unselectable for a frame or two.
      const retryDelaysMs = [0, 32, 80, 160, 320];
      for (const delayMs of retryDelaysMs) {
        window.setTimeout(() => {
          const pending = pendingRevealRef.current;
          if (!pending || pending.path !== path) {
            return;
          }
          if (runReveal(pending.path, pending.options)) {
            pendingRevealRef.current = null;
          }
        }, delayMs);
      }
    },
    [runReveal]
  );

  // Lazy directories: retry after items / directoryStates catch up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: directoryStates / model / renderSignature intentionally retrigger pending reveal after lazy loads sync into the tree.
  React.useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending) {
      return;
    }
    if (runReveal(pending.path, pending.options)) {
      pendingRevealRef.current = null;
    }
  }, [directoryStates, model, renderSignature, runReveal]);

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
      revealPath: (path, options) => {
        suppressActiveRevealRef.current = true;
        requestReveal(path, options);
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
    [model, readRefs, renameSession, requestReveal]
  );

  // Active file: select+focus+scroll nearest; expand ancestors only (not the
  // folder itself). Programmatic select must not fire onOpenPath.
  // Explicit breadcrumb/API reveals suppress this until the active path changes.
  const lastRevealRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!revealPath) {
      lastRevealRef.current = null;
      suppressActiveRevealRef.current = false;
      return;
    }
    if (revealPath !== lastRevealRef.current) {
      lastRevealRef.current = revealPath;
      suppressActiveRevealRef.current = false;
      requestReveal(revealPath, {
        expandTarget: false,
        scroll: "nearest",
      });
      return;
    }
    if (suppressActiveRevealRef.current) {
      return;
    }
  }, [requestReveal, revealPath]);

  React.useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [gitStatus, model]);

  useFileTreeLazyDirectoryLoad({
    activeSearchRef,
    expandedDirectoriesRef,
    model,
    readRefs,
    requestedLoadDirectoriesRef,
  });

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
      onClickCapture={rowClickSalvage.onClickCapture}
      onPointerDownCapture={rowClickSalvage.onPointerDownCapture}
      onPointerUpCapture={rowClickSalvage.onPointerUpCapture}
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
