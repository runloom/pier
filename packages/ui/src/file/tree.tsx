import type {
  FileTreeSelectionChangeListener,
  GitStatusEntry,
} from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import * as React from "react";
import { cn } from "../utils.ts";
import { PIER_FILE_TREE_ICONS } from "./icon-config.ts";
import { resolveExpandedPaths } from "./tree-expansion-apply.ts";
import {
  fileTreeContextMenuOption,
  itemsToGitStatusEntries,
} from "./tree-internal.ts";
import {
  collectExpandedDirectoryPaths,
  stripTrailingSlash,
  toOfficialDecoration,
  toOfficialPath,
  treeRenderSignature,
} from "./tree-model.ts";
import { FileTreeRenameSession } from "./tree-rename-session.ts";
import { usePierFileTreeScrollController } from "./tree-scroll-controller.ts";
import * as treeSearch from "./tree-search.ts";
import { pierFileTreeStyle, TREE_SCROLLBAR_CSS } from "./tree-style.ts";
import type { PierFileTreeProps } from "./tree-types.ts";
import {
  fileTreeDragAndDropConfig,
  fileTreeRenamingConfig,
} from "./tree-write-options.ts";
import { useFileTreeContextMenuComposition } from "./use-tree-context-menu.ts";
import { useFileTreeExpandCollapse } from "./use-tree-expand-collapse.ts";
import { useFileTreeLazyDirectoryLoad } from "./use-tree-lazy-directory-load.ts";
import { useFileTreePathSync } from "./use-tree-path-sync.ts";
import { useFileTreeRefs } from "./use-tree-refs.ts";
import { useFileTreeRevealController } from "./use-tree-reveal-controller.ts";
import { useFileTreeRowClickSalvage } from "./use-tree-row-click-salvage.ts";

export {
  collectKnownDirectoryPaths,
  resolveExpandedPaths,
} from "./tree-expansion-apply.ts";

export {
  filesTreeExpansionScopeId,
  getTreeExpansionAuthority,
  gitReviewTreeExpansionScopeId,
  resetTreeExpansionAuthoritiesForTests,
} from "./tree-expansion-authority.ts";
export type {
  ResolvedRevealPolicy,
  ResolveRevealPolicyInput,
} from "./tree-reveal-policy.ts";
export {
  resolveRevealIntentForPath,
  resolveRevealPolicy,
} from "./tree-reveal-policy.ts";

export type {
  PierDirectoryLoadState,
  PierFileTreeApi,
  PierFileTreeAutoRevealMode,
  PierFileTreeContextMenuItem,
  PierFileTreeContextMenuPoint,
  PierFileTreeGitStatus,
  PierFileTreeItem,
  PierFileTreeMove,
  PierFileTreeProps,
  PierFileTreeRevealIntent,
  PierFileTreeRevealOptions,
  PierFileTreeRevealScroll,
  PierFileTreeScrollController,
  PierFileTreeScrollRestoreOptions,
  PierFileTreeScrollSnapshot,
  TreeExpansionAuthority,
  TreeExpansionIntent,
  TreeExpansionSeed,
} from "./tree-types.ts";

export function PierFileTree({
  autoReveal = "on",
  directoryErrorLabel,
  directoryStates,
  expansionAuthority,
  expansionSeed = "none",
  flattenEmptyDirectories = true,
  flattenMinDepth,
  isAutoRevealExcluded,
  items,
  label,
  onLoadDirectory,
  onModelPathsRemoved,
  onMovePaths,
  onOpenItemContextMenu,
  onOpenPath,
  isActiveOpenPath,
  onContextMenuSession,
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
  const suppressAuthorityWriteRef = React.useRef(false);
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const directoryStatesRef = React.useRef(directoryStates);
  directoryStatesRef.current = directoryStates;
  const expandAllGenerationRef = React.useRef(0);
  const paths = React.useMemo(() => items.map(toOfficialPath), [items]);
  const renderSignature = React.useMemo(
    () => treeRenderSignature(items, directoryStates),
    [directoryStates, items]
  );
  const gitStatus = React.useMemo<GitStatusEntry[]>(
    () => itemsToGitStatusEntries(items),
    [items]
  );
  const initialExpandedPaths = React.useMemo(() => {
    if (expansionAuthority) {
      return resolveExpandedPaths(items, expansionAuthority.getIntent(), {
        ...(directoryStates === undefined ? {} : { directoryStates }),
        propagateCompactChains: true,
        seed: expansionSeed,
      });
    }
    return collectExpandedDirectoryPaths(items, directoryStates);
  }, [directoryStates, expansionAuthority, expansionSeed, items]);

  const { nextRefs, readRefs, refs } = useFileTreeRefs({
    directoryErrorLabel,
    directoryStates,
    items,
    onLoadDirectory,
    onModelPathsRemoved,
    onMovePaths,
    onOpenItemContextMenu,
    onOpenPath,
    isActiveOpenPath,
    onContextMenuSession,
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
        const refsSnapshot = readRefs();
        // suppressOpenPathFromContextMenu 由菜单会话 end 清掉，selection 里不消费。
        const suppressOpenPath =
          (selectedPath != null &&
            programmaticSelectionRef.current?.path === selectedPath) ||
          refsSnapshot.suppressOpenPathFromContextMenu;
        programmaticSelectionRef.current = null;
        const selectedItem =
          selectedPath == null
            ? undefined
            : refsSnapshot.itemsByPath.get(selectedPath);
        const outwardSelectedPaths = nextSelectedPaths.map(
          (path) => refsSnapshot.itemsByPath.get(path)?.path ?? path
        );

        refsSnapshot.onSelectPaths?.(outwardSelectedPaths);

        if (selectedItem?.kind === "file" && !suppressOpenPath) {
          lastOpenedPathRef.current = selectedItem.path;
          refsSnapshot.onOpenPath?.(selectedItem.path);
        }
      },
      [readRefs]
    );
  const modelAheadMovesRef = React.useRef(new Map<string, string>());
  const renameSession = React.useMemo(() => new FileTreeRenameSession(), []);

  const { model } = useFileTree({
    ...fileTreeContextMenuOption(onOpenItemContextMenu != null, refs),
    density: "compact",
    icons: PIER_FILE_TREE_ICONS,
    unsafeCSS: TREE_SCROLLBAR_CSS,
    // 只读调用方不配置模型写能力；Files 传入回调时才开启官方拖拽。
    ...(onMovePaths
      ? { dragAndDrop: fileTreeDragAndDropConfig(readRefs) }
      : {}),
    flattenEmptyDirectories,
    ...(flattenMinDepth === undefined ? {} : { flattenMinDepth }),
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
  // 右键菜单 select 必须总能拿到最新 model（避免 layout 注入竞态导致 fileTreeModel=null）。
  const modelRef = React.useRef(model);
  modelRef.current = model;
  const fileTreeModelApi = React.useMemo(
    () => ({
      focusPath: (path: string) => {
        modelRef.current.focusPath(path);
      },
      getSelectedPaths: () => modelRef.current.getSelectedPaths(),
      selectOnlyPath: (path: string) => {
        modelRef.current.selectOnlyPath(path);
      },
    }),
    []
  );
  // FileTreeRefs.fileTreeModel is readonly; replace the whole bag (same pattern as useFileTreeRefs).
  refs.current = {
    ...refs.current,
    fileTreeModel: fileTreeModelApi,
  };
  useFileTreeContextMenuComposition(model, onOpenItemContextMenu != null, refs);
  treeSearch.useSearchMatchState(model, nextRefs, onSearchMatchStateChange);
  const activeSearchRef = React.useRef<string | null>(null);

  const {
    applyDirectoryExpansion,
    collapseAllDirectories,
    expandAllDirectories,
  } = useFileTreeExpandCollapse({
    activeSearchRef,
    directoryStates,
    directoryStatesRef,
    expandAllGenerationRef,
    expandedDirectoriesRef,
    ...(expansionAuthority === undefined ? {} : { expansionAuthority }),
    expansionSeed,
    items,
    itemsRef,
    model,
    readRefs,
    renderSignature,
    suppressAuthorityWriteRef,
  });

  const {
    beginProgrammaticScroll,
    captureSnapshot,
    endProgrammaticScroll,
    restoreSnapshotSoon,
  } = usePierFileTreeScrollController({
    containerRef,
    onScrollSnapshotChange,
    scrollControllerRef,
  });

  useFileTreePathSync({
    activeSearchRef,
    applyDirectoryExpansion,
    captureSnapshot,
    directoryStates,
    expandedDirectoriesRef,
    ...(expansionAuthority === undefined ? {} : { expansionAuthority }),
    expansionSeed,
    items,
    model,
    modelAheadMovesRef,
    paths,
    renderSignature,
    restoreSnapshotSoon,
  });

  // After scroll + path-sync so reveal can suppress restore during cold open.
  const { requestReveal } = useFileTreeRevealController({
    activeSearchRef,
    autoReveal,
    beginProgrammaticScroll,
    containerRef,
    directoryStates,
    endProgrammaticScroll,
    ...(expansionAuthority === undefined ? {} : { expansionAuthority }),
    ...(isAutoRevealExcluded === undefined ? {} : { isAutoRevealExcluded }),
    model,
    programmaticSelectionRef,
    readRefs,
    renderSignature,
    revealPath,
  });

  React.useImperativeHandle(
    treeApiRef,
    () => ({
      activateFocusedSearchMatch: () =>
        treeSearch.activateFocusedMatch(model, readRefs()),
      collapseAll: collapseAllDirectories,
      expandAll: expandAllDirectories,
      expandKnownDirectories: expandAllDirectories,
      focusSearchMatch: (direction) => {
        if (direction === "next") {
          model.focusNextSearchMatch();
        } else {
          model.focusPreviousSearchMatch();
        }
      },
      getExpansionIntent: () => expansionAuthority?.getIntent() ?? null,
      getSearchMatchCount: () => model.getSearchMatchingPaths().length,
      setSearch: (searchValue) => {
        // 记录激活中的查询:resetPaths(store 重建)会让库内搜索派生投影
        // (#searchVisiblePathSet 等)与新 store 脱节,路径同步 effect 需要
        // 先清后重放(见下方 resetPaths 分支)。
        const next =
          searchValue != null && searchValue.length > 0 ? searchValue : null;
        const wasSearching = activeSearchRef.current != null;
        activeSearchRef.current = next;
        model.setSearch(searchValue);
        // Leaving search: re-apply authority so ephemeral search expands drop.
        if (wasSearching && next == null && expansionAuthority) {
          const desired = new Set(
            resolveExpandedPaths(items, expansionAuthority.getIntent(), {
              ...(directoryStates === undefined ? {} : { directoryStates }),
              propagateCompactChains: true,
              seed: expansionSeed,
            })
          );
          applyDirectoryExpansion(desired);
        }
      },
      revealPath: (path, options) => {
        // suppressActive is set inside requestReveal when policy.suppressActive.
        return requestReveal(path, options);
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
      applyPathRollback: (removedPaths, restoredPaths) => {
        try {
          model.batch([
            ...removedPaths.map((path) => ({
              path,
              recursive: true,
              type: "remove" as const,
            })),
            ...restoredPaths.map((path) => ({ path, type: "add" as const })),
          ]);
        } catch {
          // 模型可能已被 watch 刷新自愈;忽略回滚失败。
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
    [
      applyDirectoryExpansion,
      collapseAllDirectories,
      directoryStates,
      expandAllDirectories,
      expansionAuthority,
      expansionSeed,
      items,
      model,
      readRefs,
      renameSession,
      requestReveal,
    ]
  );

  React.useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [gitStatus, model]);

  useFileTreeLazyDirectoryLoad({
    activeSearchRef,
    expandedDirectoriesRef,
    ...(expansionAuthority === undefined ? {} : { expansionAuthority }),
    model,
    readRefs,
    requestedLoadDirectoriesRef,
    suppressAuthorityWriteRef,
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
