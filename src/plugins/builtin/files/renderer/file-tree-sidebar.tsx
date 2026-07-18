import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  PierFileTree,
  type PierFileTreeApi,
  type PierFileTreeItem,
  type PierFileTreeMove,
} from "@pier/ui/file-tree.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  extractItemPathFromEvent,
  type FileTreeSidebarProps,
  toTreeItem,
  useFilesTreeSnapshot,
} from "./file-tree-sidebar-helpers.ts";
import {
  type DoubleClickTrack,
  detectDoubleClick,
} from "./files-double-click.ts";
import { createFilesTranslate } from "./files-i18n.ts";
import { FilesMutationSuspendedError } from "./files-mutation-gate.ts";
import { recordFilesPathMru } from "./files-quick-open-mru.ts";
import { FilesSearchBar } from "./files-search-bar.tsx";
import { useFilesTreeContextMenus } from "./files-tree-context-menu.ts";
import { cancelInlineCreate, commitInlineCreate } from "./files-tree-create.ts";
import {
  buildGitStatusByPath,
  EMPTY_GIT_DECORATIONS,
  type FilesGitDecorations,
  ignoredStatusFor,
  splitIgnoredEntries,
} from "./files-tree-git-decorations.ts";
import {
  hasPendingCreatePath,
  peekPendingCreate,
  registerFilesTreeInstance,
} from "./files-tree-registry.ts";
import { handleFilesTreeSearchKeyDown } from "./files-tree-search-keydown.ts";
import {
  loadFilesTreeDirectory,
  moveFilesTreeEntry,
  reloadFilesTreeRoot,
} from "./files-tree-store.ts";
import { useFilesTreeSearch } from "./use-files-tree-search.ts";
import { useFilesTreeVisibility } from "./use-files-tree-visibility.ts";

const TREE_DOUBLE_CLICK_WINDOW_MS = 400;
export function FileTreeSidebar({
  activeFilePath,
  context,
  controller,
  instanceId,
  onOpenFile,
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
  const [gitDecorations, setGitDecorations] = useState<FilesGitDecorations>(
    EMPTY_GIT_DECORATIONS
  );
  useEffect(() => {
    const gitApi = (context as Partial<RendererPluginContext>).git;
    if (!gitApi?.getStatus) {
      return;
    }
    let disposed = false;
    const applyStatus = (status: GitStatus | undefined) => {
      if (!disposed && status) {
        setGitDecorations((previous) => ({
          ...previous,
          changedByPath: buildGitStatusByPath(status.files),
        }));
      }
    };
    const refreshIgnored = () => {
      treeVisibility
        .refreshGitIgnored(root)
        .then(({ changed, entries }) => {
          if (!disposed) {
            setGitDecorations((previous) => ({
              ...previous,
              ...splitIgnoredEntries(entries),
            }));
            if (changed && !treeVisibility.showsGitIgnoredFiles()) {
              reloadTreeVisibility().catch(() => undefined);
            }
          }
        })
        .catch(() => undefined);
    };
    const refresh = () => {
      gitApi
        .getStatus(root)
        .then(applyStatus)
        .catch(() => undefined);
      refreshIgnored();
    };
    refresh();
    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = gitApi.watch(root, (event) => {
        if (event.status) {
          applyStatus(event.status);
          refreshIgnored();
        } else {
          refresh();
        }
      });
    } catch {}
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [context, reloadTreeVisibility, root, treeVisibility]);

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
      const title = t(
        "filePanel.tree.loadDirectoryFailed",
        "Unable to load folder"
      );
      if (result.error instanceof Error) {
        await context.dialogs.alert({
          body: result.error.message,
          size: "default",
          title,
        });
      } else {
        context.notifications.error(title);
      }
    },
    [context, root, t, treeVisibility]
  );

  const performMove = useCallback(
    async (from: string, to: string, options?: { silent?: boolean }) => {
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
        if (error instanceof FilesMutationSuspendedError) {
          return;
        }
        await context.dialogs.alert({
          body: error instanceof Error ? error.message : String(error),
          size: "default",
          title: t("filePanel.tree.renameFailed", "Unable to rename"),
        });
        reloadFilesTreeRoot(
          root,
          treeVisibility.list,
          t("panel.loadError.fallback", "Failed to load files")
        );
      }
    },
    [context, controller, root, t, treeVisibility]
  );
  const performMoveRef = useRef<typeof performMove | null>(null);
  performMoveRef.current = performMove;

  const handleMovePaths = useCallback(
    (moves: readonly PierFileTreeMove[]) => {
      (async () => {
        for (const move of moves) {
          if (move.from === move.to) {
            continue;
          }
          await performMove(move.from, move.to);
        }
      })().catch(() => undefined);
    },
    [performMove]
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
    ...(sourcePanelId ? { sourcePanelId } : {}),
    t,
  });

  let content: ReactNode = null;
  if (snapshot.rootError) {
    content = (
      <Alert className="m-3" variant="destructive">
        <AlertTitle>
          {t("panel.loadError.title", "Unable to load files")}
        </AlertTitle>
        <AlertDescription>{snapshot.rootError}</AlertDescription>
      </Alert>
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
        className="min-h-0 w-full flex-1"
        directoryErrorLabel={t("filePanel.tree.directoryError", "Error")}
        directoryStates={snapshot.directoryStatesByPath}
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
        treeApiRef={treeSearch.attachTreeApi}
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
        <div className="shrink-0 px-2 py-1">
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
      <div className="flex min-h-0 flex-1">{content}</div>
    </aside>
  );
}
