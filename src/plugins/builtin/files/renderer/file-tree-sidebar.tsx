import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
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
import { SearchX } from "lucide-react";
import {
  type CSSProperties,
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
import {
  loadFilesTreeDirectory,
  moveFilesTreeEntry,
  reloadFilesTreeRoot,
} from "./files-tree-store.ts";
import { useFilesTreeSearch } from "./use-files-tree-search.ts";
import { useFilesTreeVisibility } from "./use-files-tree-visibility.ts";

const TREE_DOUBLE_CLICK_WINDOW_MS = 400;
const FILES_TREE_STYLE: CSSProperties & {
  "--trees-padding-inline-override": string;
} = { "--trees-padding-inline-override": "4px" };

export function FileTreeSidebar({
  activeFilePath,
  context,
  controller,
  instanceId,
  onOpenFile,
  root,
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
  // Git 装饰:变更染色(getStatus + git.watch 增量) + ignored 变暗(listIgnored)。
  const [gitDecorations, setGitDecorations] = useState<FilesGitDecorations>(
    EMPTY_GIT_DECORATIONS
  );
  useEffect(() => {
    // git namespace 是可缺失能力(无 git:read 的宿主/测试环境):树退化为无染色。
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
    } catch {
      // 非 git 目录/watch 能力缺失:保留一次性染色。
    }
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [context, reloadTreeVisibility, root, treeVisibility]);

  const items = useMemo<PierFileTreeItem[]>(
    () =>
      [...snapshot.entriesByPath.values()].map((entry) => {
        const item = toTreeItem(entry);
        // 变更状态优先于 ignored(ignored 路径不会出现在 status 里,但保守起见)。
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
    list: treeVisibility.list,
    root,
    searchFailedTitle: t(
      "filePanel.tree.searchFailed",
      "Unable to search all folders"
    ),
    treeApiRef,
  });

  useEffect(() => {
    const entry = {
      getApi: () => treeApiRef.current,
      openSearch: treeSearch.openSearch,
      root,
    };
    return registerFilesTreeInstance(instanceId, entry);
  }, [instanceId, root, treeSearch.openSearch]);
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

  // 拖拽/inline rename 共用的真实 fs move + 级联;失败刷新树回滚视觉状态。
  // 成功后 toast 提供「撤销」= 反向 move(撤销本身不再叠加 toast,防循环)。
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
        style={FILES_TREE_STYLE}
        treeApiRef={treeSearch.attachTreeApi}
      />
    );
  }

  let treeSearchMatchText = "";
  if (treeSearch.value.trim().length > 0) {
    treeSearchMatchText = treeSearch.loading
      ? t("filePanel.tree.searching", "Searching…")
      : String(treeSearch.matchCount);
  }
  const searchHasNoResults =
    snapshot.rootLoaded &&
    !snapshot.rootError &&
    treeSearch.open &&
    treeSearch.value.trim().length > 0 &&
    !treeSearch.loading &&
    treeSearch.queryApplied &&
    treeSearch.matchCount === 0;
  const searchActionsDisabled =
    treeSearch.loading || treeSearch.matchCount === 0;

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: contextmenu bubbles from tree children; aside just captures.
    <aside
      className="flex h-full min-h-0 w-full flex-col bg-sidebar/50"
      onContextMenu={handleTreeBackgroundContextMenu}
      onDoubleClick={handleTreeDoubleClick}
    >
      {/* 树头行已按目标布局移除（项目名在面包屑首段）；搜索条按需出现，
          文件新鲜度统一由 watcher 维护，不提供手动刷新入口。 */}
      {treeSearch.open ? (
        <div className="shrink-0 px-2 pb-1.5">
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
            matchText={treeSearchMatchText}
            navigationDisabled={searchActionsDisabled}
            onChange={treeSearch.changeSearch}
            onClose={treeSearch.closeSearch}
            onNavigate={treeSearch.navigateSearch}
            onSubmit={treeSearch.openFocusedMatch}
            submitDisabled={
              searchActionsDisabled || !treeSearch.focusedMatchOpenable
            }
            testId="files-tree-search-bar"
            value={treeSearch.value}
          />
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1">
        {content}
        {searchHasNoResults ? (
          <Empty
            aria-live="polite"
            className="absolute inset-0 z-10 min-h-0 rounded-none border-0 bg-sidebar/95 p-4"
            data-testid="files-tree-search-empty"
            role="status"
          >
            <EmptyHeader className="gap-1.5">
              <EmptyMedia className="mb-1" variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle className="text-sm">
                {t("filePanel.tree.noSearchResults.title", "No matching files")}
              </EmptyTitle>
              <EmptyDescription className="text-xs">
                {t(
                  "filePanel.tree.noSearchResults.description",
                  "Try another file name or path."
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>
    </aside>
  );
}
