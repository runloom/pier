import type {
  FileTreeSelectionChangeListener,
  GitStatusEntry,
} from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import * as React from "react";
import {
  buildRowDecoration,
  cloneCompositionForRedraw,
  collectExpandedDirectoryPaths,
  isDirectoryHandle,
  lastSegment,
  resolveDirectoryLoadState,
  samePaths,
  singlePathMutation,
  stripTrailingSlash,
  toOfficialDecoration,
  toOfficialPath,
  treeRenderSignature,
} from "./file-tree-model.ts";
import { usePierFileTreeScrollController } from "./file-tree-scroll-controller.ts";
import { pierFileTreeStyle } from "./file-tree-style.ts";
import type {
  PierDirectoryLoadState,
  PierFileTreeItem,
  PierFileTreeMove,
  PierFileTreeProps,
} from "./file-tree-types.ts";
import { cn } from "./utils.ts";

export type {
  PierDirectoryLoadState,
  PierFileTreeApi,
  PierFileTreeGitStatus,
  PierFileTreeItem,
  PierFileTreeMove,
  PierFileTreeProps,
  PierFileTreeScrollController,
  PierFileTreeScrollRestoreOptions,
  PierFileTreeScrollSnapshot,
} from "./file-tree-types.ts";

interface FileTreeRefs {
  decorationsByPath: ReadonlyMap<string, React.ReactNode>;
  directoryLoadStatesByPath: ReadonlyMap<string, PierDirectoryLoadState>;
  itemsByPath: ReadonlyMap<string, PierFileTreeItem>;
  loadableDirectoryPaths: ReadonlyMap<string, string>;
  onLoadDirectory: ((path: string) => Promise<void> | void) | undefined;
  onMovePaths: ((moves: readonly PierFileTreeMove[]) => void) | undefined;
  onOpenPath: ((path: string) => void) | undefined;
  onRenamePath:
    | ((move: PierFileTreeMove & { isFolder: boolean }) => void)
    | undefined;
  onSelectPaths: ((paths: string[]) => void) | undefined;
}

const EMPTY_REFS: FileTreeRefs = {
  decorationsByPath: new Map(),
  directoryLoadStatesByPath: new Map(),
  itemsByPath: new Map(),
  loadableDirectoryPaths: new Map(),
  onLoadDirectory: undefined,
  onMovePaths: undefined,
  onOpenPath: undefined,
  onRenamePath: undefined,
  onSelectPaths: undefined,
};

export function PierFileTree({
  directoryStates,
  items,
  label,
  onLoadDirectory,
  onMovePaths,
  onOpenPath,
  onRenamePath,
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
  const refs = React.useRef<FileTreeRefs>(EMPTY_REFS);
  const expandedDirectoriesRef = React.useRef(new Map<string, boolean>());
  const requestedLoadDirectoriesRef = React.useRef(new Set<string>());
  const didMountRef = React.useRef(false);
  const paths = React.useMemo(() => items.map(toOfficialPath), [items]);
  const previousPathsRef = React.useRef<readonly string[]>(paths);
  const renderSignature = React.useMemo(
    () => treeRenderSignature(items, directoryStates),
    [directoryStates, items]
  );
  const previousRenderSignatureRef = React.useRef(renderSignature);
  const gitStatus = React.useMemo<GitStatusEntry[]>(
    () =>
      items.flatMap((item) =>
        item.gitStatus == null
          ? []
          : [{ path: toOfficialPath(item), status: item.gitStatus }]
      ),
    [items]
  );
  const initialExpandedPaths = React.useMemo(
    () => collectExpandedDirectoryPaths(items, directoryStates),
    [directoryStates, items]
  );

  refs.current = React.useMemo<FileTreeRefs>(() => {
    const decorationsByPath = new Map<string, React.ReactNode>();
    const directoryLoadStatesByPath = new Map<string, PierDirectoryLoadState>();
    const itemsByPath = new Map<string, PierFileTreeItem>();
    const loadableDirectoryPaths = new Map<string, string>();

    for (const item of items) {
      const officialPath = toOfficialPath(item);

      itemsByPath.set(item.path, item);
      itemsByPath.set(officialPath, item);

      const directoryLoadState = resolveDirectoryLoadState(
        item,
        directoryStates
      );
      if (directoryLoadState != null) {
        directoryLoadStatesByPath.set(item.path, directoryLoadState);
        directoryLoadStatesByPath.set(officialPath, directoryLoadState);
        loadableDirectoryPaths.set(officialPath, item.path);
      }

      const decoration = buildRowDecoration(item, directoryStates);
      if (decoration != null) {
        decorationsByPath.set(item.path, decoration);
        decorationsByPath.set(officialPath, decoration);
      }
    }

    return {
      decorationsByPath,
      directoryLoadStatesByPath,
      itemsByPath,
      loadableDirectoryPaths,
      onLoadDirectory: undefined,
      onMovePaths: undefined,
      onOpenPath: undefined,
      onRenamePath: undefined,
      onSelectPaths: undefined,
    };
  }, [directoryStates, items]);

  refs.current.onLoadDirectory = onLoadDirectory;
  refs.current.onMovePaths = onMovePaths;
  refs.current.onOpenPath = onOpenPath;
  refs.current.onRenamePath = onRenamePath;
  refs.current.onSelectPaths = onSelectPaths;

  const fileTreeStyle = React.useMemo(() => pierFileTreeStyle(style), [style]);

  const handleSelectionChange =
    React.useCallback<FileTreeSelectionChangeListener>((selectedPaths) => {
      const nextSelectedPaths = [...selectedPaths];
      const selectedPath = nextSelectedPaths.at(-1);
      const selectedItem =
        selectedPath == null
          ? undefined
          : refs.current.itemsByPath.get(selectedPath);
      const outwardSelectedPaths = nextSelectedPaths.map(
        (path) => refs.current.itemsByPath.get(path)?.path ?? path
      );

      refs.current.onSelectPaths?.(outwardSelectedPaths);

      if (selectedItem?.kind === "file") {
        refs.current.onOpenPath?.(selectedItem.path);
      }
    }, []);

  const { model } = useFileTree({
    density: "compact",
    // 拖拽移动:库在模型层先行 move,onDropComplete 把 official path 折算成
    // caller path 交业务方执行真实 fs move;失败方负责刷新树回滚视觉状态。
    dragAndDrop: {
      onDropComplete: (event) => {
        const handler = refs.current.onMovePaths;
        if (!handler) {
          return;
        }
        const targetDirOfficial =
          event.target.kind === "directory" ? event.target.directoryPath : null;
        const targetDir =
          targetDirOfficial === null
            ? ""
            : stripTrailingSlash(targetDirOfficial);
        const moves = event.draggedPaths.map((draggedPath) => {
          const from = stripTrailingSlash(draggedPath);
          const name = lastSegment(from);
          return {
            from,
            to: targetDir.length > 0 ? `${targetDir}/${name}` : name,
          };
        });
        if (moves.length > 0) {
          handler(moves);
        }
      },
    },
    flattenEmptyDirectories: true,
    gitStatus,
    initialExpandedPaths,
    onSelectionChange: handleSelectionChange,
    paths,
    renaming: {
      onRename: (event) => {
        refs.current.onRenamePath?.({
          from: stripTrailingSlash(event.sourcePath),
          isFolder: event.isFolder,
          to: stripTrailingSlash(event.destinationPath),
        });
      },
    },
    // 搜索走 setSearch 编程驱动 + 业务层自绘搜索栏;不渲染库内置搜索头。
    fileTreeSearchMode: "hide-non-matches",
    renderRowDecoration: ({ item }) =>
      toOfficialDecoration(refs.current.decorationsByPath.get(item.path)),
    ...(stickyFolders ? { stickyFolders: true } : {}),
  });

  const activeSearchRef = React.useRef<string | null>(null);

  React.useImperativeHandle(
    treeApiRef,
    () => ({
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
          const ancestorItem = refs.current.itemsByPath.get(ancestorPath);
          if (!ancestorItem) {
            continue;
          }
          const handle = model.getItem(toOfficialPath(ancestorItem));
          if (isDirectoryHandle(handle) && !handle.isExpanded()) {
            handle.expand();
          }
        }
        const item = refs.current.itemsByPath.get(path);
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
      startRenaming: (path) => {
        const item = refs.current.itemsByPath.get(path);
        const officialPath = item ? toOfficialPath(item) : path;
        return model.startRenaming(officialPath);
      },
    }),
    [model]
  );

  // auto-reveal:active 文件变化时滚动到该行并选中。选中经 model 层,
  // 不触发 onOpenPath(selection listener 只在用户操作路径 openPath)。
  const lastRevealRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!revealPath || revealPath === lastRevealRef.current) {
      if (!revealPath) {
        lastRevealRef.current = null;
      }
      return;
    }
    const item = refs.current.itemsByPath.get(revealPath);
    if (!item) {
      return;
    }
    lastRevealRef.current = revealPath;
    const officialPath = toOfficialPath(item);
    try {
      model.scrollToPath(officialPath, { focus: false, offset: "nearest" });
      model.focusPath(officialPath);
    } catch {
      // 路径尚未在可见投影中(父目录未展开):静默忽略,下一次 items 变化重试。
      lastRevealRef.current = null;
    }
  }, [model, revealPath]);

  React.useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [gitStatus, model]);

  const syncDirectoryExpansionState = React.useCallback(
    (notifyOnExpand: boolean) => {
      const loadableDirectoryPaths = refs.current.loadableDirectoryPaths;

      for (const trackedPath of expandedDirectoriesRef.current.keys()) {
        if (!loadableDirectoryPaths.has(trackedPath)) {
          expandedDirectoriesRef.current.delete(trackedPath);
        }
      }

      for (const requestedPath of requestedLoadDirectoriesRef.current) {
        if (
          !loadableDirectoryPaths.has(requestedPath) ||
          refs.current.directoryLoadStatesByPath.get(requestedPath) !==
            "unloaded"
        ) {
          requestedLoadDirectoriesRef.current.delete(requestedPath);
        }
      }

      for (const [officialPath, callerPath] of loadableDirectoryPaths) {
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

        const onLoadDirectory = refs.current.onLoadDirectory;

        if (
          onLoadDirectory == null ||
          refs.current.directoryLoadStatesByPath.get(officialPath) !==
            "unloaded" ||
          requestedLoadDirectoriesRef.current.has(officialPath)
        ) {
          continue;
        }

        requestedLoadDirectoriesRef.current.add(officialPath);
        onLoadDirectory(callerPath);
      }
    },
    [model]
  );

  React.useEffect(() => {
    syncDirectoryExpansionState(false);
    return model.subscribe(() => {
      syncDirectoryExpansionState(true);
    });
  }, [model, syncDirectoryExpansionState]);

  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      previousPathsRef.current = paths;
      previousRenderSignatureRef.current = renderSignature;
      return;
    }

    const previousPaths = previousPathsRef.current;
    if (samePaths(previousPaths, paths)) {
      if (previousRenderSignatureRef.current !== renderSignature) {
        model.setComposition(cloneCompositionForRedraw(model.getComposition()));
      }
      previousPathsRef.current = paths;
      previousRenderSignatureRef.current = renderSignature;
      return;
    }

    const localMutation = singlePathMutation(previousPaths, paths);
    if (localMutation) {
      model.batch(localMutation);
      previousPathsRef.current = paths;
      previousRenderSignatureRef.current = renderSignature;
      return;
    }

    const expandedPaths = new Set(initialExpandedPaths);

    for (const [officialPath, callerPath] of refs.current
      .loadableDirectoryPaths) {
      const itemHandle = model.getItem(officialPath);

      if (isDirectoryHandle(itemHandle) && itemHandle.isExpanded()) {
        expandedPaths.add(callerPath);
      }
    }

    // resetPaths 重建内部 store,但控制器的搜索派生投影(匹配集/可见集/
    // 展开快照)不会随之重建 —— 激活中的搜索先清掉,重建后重放,否则
    // 之后清空搜索会还原到脱节状态(树滞留过滤态甚至空白)。
    const activeSearch = activeSearchRef.current;
    if (activeSearch != null) {
      model.setSearch(null);
    }
    model.resetPaths(paths, { initialExpandedPaths: [...expandedPaths] });
    if (activeSearch != null) {
      model.setSearch(activeSearch);
    }
    previousPathsRef.current = paths;
    previousRenderSignatureRef.current = renderSignature;
  }, [initialExpandedPaths, model, paths, renderSignature]);

  usePierFileTreeScrollController({
    containerRef,
    onScrollSnapshotChange,
    scrollControllerRef,
  });

  return (
    <div
      className={cn("h-full min-h-0 w-full", className)}
      data-slot="pier-file-tree-bridge"
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
