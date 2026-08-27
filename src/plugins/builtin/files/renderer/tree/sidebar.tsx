import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { ErrorEmpty } from "@pier/ui/error-empty.tsx";
import {
  PierFileTree,
  type PierFileTreeApi,
  type PierFileTreeItem,
  type PierFileTreeMove,
} from "@pier/ui/file/tree.tsx";
import { FILE_TREE_SEARCH_SHELL_CLASS } from "@pier/ui/file/tree-style.ts";
import { Skeleton } from "@pier/ui/skeleton.tsx";

import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { isFileMissingError } from "../editor/errors.ts";
import { createFilesTranslate } from "../i18n.ts";
import { FilesMutationSuspendedError } from "../mutation/gate.ts";
import { FilesSearchBar } from "../search/bar.tsx";
import { recordFilesPathMru } from "../search/quick-open-mru.ts";
import { confirmTreeMoves, handleTreeDragMoves } from "./action-utils.ts";
import { useFilesTreeContextMenus } from "./context-menu.ts";
import { cancelInlineCreate, commitInlineCreate } from "./create.ts";
import { type DoubleClickTrack, detectDoubleClick } from "./double-click.ts";
import { ExternalActiveFileEntry } from "./external-file-entry.tsx";
import { ignoredStatusFor } from "./git-decorations.ts";
import {
  hasPendingCreatePath,
  peekPendingCreate,
  registerFilesTreeInstance,
  rollbackFilesTreeModelMove,
} from "./registry.ts";
import { handleFilesTreeSearchKeyDown } from "./search-keydown.ts";
import {
  extractItemPathFromEvent,
  type FileTreeSidebarProps,
  toTreeItem,
  useFilesTreeSnapshot,
} from "./sidebar-helpers.ts";
import {
  loadFilesTreeDirectory,
  moveFilesTreeEntry,
  reloadFilesTreeRoot,
} from "./store.ts";
import { useFilesTreeGitDecorations } from "./use-git-decorations.ts";
import { useFilesTreeSearch } from "./use-search.ts";
import { useFilesTreeSidebarPrefs } from "./use-sidebar-prefs.ts";
import { useFilesTreeVisibility } from "./use-visibility.ts";

const TREE_DOUBLE_CLICK_WINDOW_MS = 400;
export function FileTreeSidebar({
  activeFilePath,
  context,
  controller,
  externalActiveFile,
  instanceId,
  onOpenFile,
  projectRoot,
  root,
  sourcePanelId,
  watchHub,
}: FileTreeSidebarProps) {
  const t = useMemo(() => createFilesTranslate(context), [context]);
  const { controller: treeVisibility, reload: reloadTreeVisibility } =
    useFilesTreeVisibility(
      context,
      root,
      t("panel.loadError.fallback", "Failed to load files")
    );
  const snapshot = useFilesTreeSnapshot(
    context,
    root,
    watchHub,
    treeVisibility.list
  );
  const gitDecorations = useFilesTreeGitDecorations({
    context,
    reloadTreeVisibility,
    root,
    treeVisibility,
  });

  const {
    autoReveal,
    compactFolders,
    expansionAuthority,
    isAutoRevealExcluded,
  } = useFilesTreeSidebarPrefs({
    activeFilePath,
    context,
    controller: treeVisibility,
    list: treeVisibility.list,
    reload: reloadTreeVisibility,
    root,
  });

  const items = useMemo<PierFileTreeItem[]>(
    () =>
      [...snapshot.entriesByPath.values()].map((entry) => {
        const item = toTreeItem(entry);
        const gitStatus =
          gitDecorations.changedByPath.get(entry.path) ??
          ignoredStatusFor(entry.path, gitDecorations);
        return gitStatus ? { ...item, gitStatus } : item;
      }),
    [gitDecorations, snapshot.entriesByPath]
  );

  const treeApiRef = useRef<PierFileTreeApi | null>(null);
  const treeSearch = useFilesTreeSearch({
    context,
    fallbackError: t("panel.loadError.fallback", "Failed to load files"),
    instanceId,
    list: treeVisibility.list,
    root,
    searchFailedTitle: t(
      "filePanel.tree.searchFailed",
      "Unable to search files"
    ),
    treeApiRef,
  });

  useEffect(() => {
    const entry = {
      collapseAll: () => {
        treeApiRef.current?.collapseAll();
      },
      expandKnownDirectories: () => {
        treeApiRef.current?.expandAll();
      },
      getApi: () => treeApiRef.current,
      openSearch: treeSearch.openSearch,
      root,
      toggleSearch: treeSearch.toggleSearch,
    };
    return registerFilesTreeInstance(instanceId, entry);
  }, [instanceId, root, treeSearch.openSearch, treeSearch.toggleSearch]);

  const selectedPathsRef = useRef<readonly string[]>([]);
  const handleSelectPaths = useCallback((paths: string[]) => {
    selectedPathsRef.current = paths;
  }, []);

  const loadDirectory = useCallback(
    async (path: string) => {
      const result = await loadFilesTreeDirectory(
        root,
        path,
        treeVisibility.list
      );
      if (result.ok) {
        return;
      }
      // Missing path: tree already marks the row error/retryable. Do not stack
      // a host alert on top of document Empty (disk-conflict / deleted) — that
      // double feedback is pure noise (e.g. expand of a removed skill folder).
      if (isFileMissingError(result.error)) {
        return;
      }
      const title = t(
        "filePanel.tree.loadDirectoryFailed",
        "Unable to load folder"
      );
      if (result.error instanceof Error) {
        await context.dialogs.alert({
          body: result.error.message,
          title,
        });
      } else {
        context.notifications.error(title);
      }
    },
    [context, root, t, treeVisibility]
  );

  const performMove = useCallback(
    async (
      from: string,
      to: string,
      options?: { silent?: boolean; rollbackModel?: boolean }
    ) => {
      try {
        await controller.runMutation(async () => {
          await controller.movePath(root, from, to);
          moveFilesTreeEntry(root, from, to);
          if (!options?.silent) {
            const name = to.split("/").at(-1) ?? to;
            context.notifications.success(
              t("filePanel.tree.moved", `Moved "${name}"`),
              {
                action: {
                  label: t("filePanel.tree.undo", "Undo"),
                  onClick: () => {
                    performMoveRef.current?.(to, from, { silent: true });
                  },
                },
              }
            );
          }
        });
      } catch (error) {
        if (options?.rollbackModel !== false) {
          // 库已先行把模型移到 to；磁盘失败时必须回滚模型，否则幽灵行残留
          // 且 force reload 因条目集合不变无法自愈。
          rollbackFilesTreeModelMove({
            instanceId,
            removedPaths: [to],
            restoredPaths: [from],
            root,
          });
        }
        if (error instanceof FilesMutationSuspendedError) {
          return;
        }
        await context.dialogs.alert({
          body: error instanceof Error ? error.message : String(error),
          title: t("filePanel.tree.renameFailed", "Unable to rename"),
        });
        reloadFilesTreeRoot(
          root,
          treeVisibility.list,
          t("panel.loadError.fallback", "Failed to load files")
        );
      }
    },
    [context, controller, instanceId, root, t, treeVisibility]
  );
  const performMoveRef = useRef<typeof performMove | null>(null);
  performMoveRef.current = performMove;

  const handleMovePaths = useCallback(
    (moves: readonly PierFileTreeMove[]) => {
      handleTreeDragMoves({
        confirm: (validMoves) =>
          confirmTreeMoves({ context, moves: validMoves, t }),
        moves,
        performMove: (from, to) =>
          performMove(from, to, { rollbackModel: false }),
      }).catch(() => undefined);
    },
    [context, performMove, t]
  );

  const handleRenamePath = useCallback(
    (move: PierFileTreeMove & { isFolder: boolean }) => {
      if (peekPendingCreate(root, move.from)) {
        commitInlineCreate({
          context,
          from: move.from,
          root,
          to: move.to,
        }).catch(() => undefined);
        return;
      }
      if (move.from !== move.to) {
        performMove(move.from, move.to).catch(() => undefined);
      }
    },
    [context, performMove, root]
  );

  const handleModelPathsRemoved = useCallback(
    (paths: readonly string[]) => {
      for (const path of paths) {
        if (peekPendingCreate(root, path)) {
          cancelInlineCreate(root, path);
        }
      }
    },
    [root]
  );

  const lastOpenRef = useRef<DoubleClickTrack | null>(null);
  const openPath = useCallback(
    (path: string) => {
      // 新建占位尚未落盘,禁止打开以免 readText 失败。
      if (hasPendingCreatePath(root, path)) {
        return;
      }
      const entry = snapshot.entriesByPath.get(path);
      if (entry?.kind !== "file") {
        return;
      }
      const { isDouble, nextTrack } = detectDoubleClick(
        path,
        Date.now(),
        lastOpenRef.current,
        TREE_DOUBLE_CLICK_WINDOW_MS
      );
      lastOpenRef.current = nextTrack;
      recordFilesPathMru(root, path);
      onOpenFile(entry, isDouble ? { pinned: true } : undefined);
    },
    [onOpenFile, root, snapshot.entriesByPath]
  );

  const handleTreeDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const path = extractItemPathFromEvent(event.nativeEvent);
      if (!path || hasPendingCreatePath(root, path)) {
        return;
      }
      const entry = snapshot.entriesByPath.get(path);
      if (entry?.kind !== "file") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onOpenFile(entry, { pinned: true });
    },
    [onOpenFile, root, snapshot.entriesByPath]
  );

  const {
    openBackgroundContextMenu: handleTreeBackgroundContextMenu,
    openItemContextMenu: handleItemContextMenu,
  } = useFilesTreeContextMenus({
    context,
    entriesByPath: snapshot.entriesByPath,
    instanceId,
    root,
    selectedPathsRef,
    ...(projectRoot ? { projectRoot } : {}),
    ...(sourcePanelId ? { sourcePanelId } : {}),
    t,
  });

  let content: ReactNode = null;
  if (snapshot.rootError) {
    content = (
      <ErrorEmpty
        className="min-h-0 flex-1 rounded-none border-0 p-4"
        description={snapshot.rootError}
        title={t("panel.loadError.title", "Unable to load files")}
      />
    );
  } else if (!snapshot.rootLoaded) {
    content = (
      <div
        aria-label={t("panel.loading.label", "Loading files")}
        className="flex min-h-0 flex-1 flex-col gap-2 p-3"
        role="status"
      >
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-4 w-36" />
      </div>
    );
  } else if (items.length === 0) {
    content = (
      <Empty className="min-h-0 flex-1 px-3">
        <EmptyHeader>
          <EmptyTitle>{t("panel.empty.title", "No files found")}</EmptyTitle>
          <EmptyDescription>
            {t(
              "panel.empty.description",
              "This project root does not contain files to show."
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    content = (
      <PierFileTree
        autoReveal={autoReveal}
        className="min-h-0 w-full flex-1"
        directoryErrorLabel={t("filePanel.tree.directoryError", "Error")}
        directoryStates={snapshot.directoryStatesByPath}
        expansionAuthority={expansionAuthority}
        expansionSeed="none"
        flattenEmptyDirectories={compactFolders}
        isAutoRevealExcluded={isAutoRevealExcluded}
        items={items}
        label={t("panel.tree.label", "Files")}
        onLoadDirectory={loadDirectory}
        onModelPathsRemoved={handleModelPathsRemoved}
        onMovePaths={handleMovePaths}
        onOpenItemContextMenu={handleItemContextMenu}
        onOpenPath={openPath}
        onRenamePath={handleRenamePath}
        onSearchMatchStateChange={treeSearch.updateMatchState}
        onSelectPaths={handleSelectPaths}
        revealPath={activeFilePath ?? null}
        stickyFolders
        treeApiRef={treeApiRef}
      />
    );
  }

  const treeSearchMatchText = treeSearch.open
    ? treeSearch.matchText ||
      (treeSearch.loading ? t("filePanel.tree.searching", "Searching…") : "")
    : "";
  let treeSearchMatchAnnouncement = "";
  if (treeSearch.loading && treeSearch.matchCount === 0) {
    treeSearchMatchAnnouncement = t("filePanel.tree.searching", "Searching…");
  } else if (treeSearch.matchCount > 0) {
    const count = treeSearch.truncated
      ? `${treeSearch.matchCount}+`
      : treeSearch.matchCount;
    treeSearchMatchAnnouncement = t(
      "filePanel.search.matchAnnouncement",
      "Matches: {{count}}",
      { count }
    );
  }
  // 有 batch 命中后即可导航；勿因 path query 仍 loading 锁死上下键/Enter。
  const searchActionsDisabled = treeSearch.matchCount === 0;
  const hasNoResults =
    treeSearch.open &&
    treeSearch.value.trim().length > 0 &&
    !treeSearch.loading &&
    treeSearch.queryApplied &&
    treeSearch.matchCount === 0;

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: contextmenu + search keyboard bubble from tree children; aside just captures.
    <aside
      className="flex h-full min-h-0 w-full flex-col bg-sidebar"
      onContextMenu={handleTreeBackgroundContextMenu}
      onDoubleClick={handleTreeDoubleClick}
      onKeyDown={(event) => {
        handleFilesTreeSearchKeyDown(event, {
          closeSearch: treeSearch.closeSearch,
          focusedMatchOpenable: treeSearch.focusedMatchOpenable,
          navigateSearch: treeSearch.navigateSearch,
          open: treeSearch.open,
          openFocusedMatch: treeSearch.openFocusedMatch,
          searchActionsDisabled,
        });
      }}
    >
      {treeSearch.open ? (
        <div className={FILE_TREE_SEARCH_SHELL_CLASS}>
          <FilesSearchBar
            className="w-full"
            focusSignal={treeSearch.focusSignal}
            labels={{
              close: t("filePanel.search.close", "Close"),
              next: t("filePanel.search.next", "Next match"),
              open: t("filePanel.tree.openSearchResult", "Open selected file"),
              placeholder: t("panel.tree.search", "Find in tree"),
              previous: t("filePanel.search.previous", "Previous match"),
            }}
            matchAnnouncement={treeSearchMatchAnnouncement}
            matchText={treeSearchMatchText}
            navigationDisabled={searchActionsDisabled}
            onChange={treeSearch.changeSearch}
            onClose={treeSearch.closeSearch}
            onNavigate={treeSearch.navigateSearch}
            onSubmit={treeSearch.openFocusedMatch}
            submitDisabled={
              searchActionsDisabled || !treeSearch.focusedMatchOpenable
            }
            surface="sidebar"
            testId="files-tree-search-bar"
            value={treeSearch.value}
          />
        </div>
      ) : null}
      {hasNoResults ? (
        <div
          className="px-3 py-2 text-muted-foreground text-xs"
          data-testid="files-tree-search-empty"
        >
          {t("filePanel.tree.noSearchResults.title", "No matching files")}
        </div>
      ) : null}
      {externalActiveFile ? (
        <ExternalActiveFileEntry
          externalActiveFile={externalActiveFile}
          t={t}
        />
      ) : null}
      <div className="flex min-h-0 flex-1">{content}</div>
    </aside>
  );
}
