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
import type { FileEntry } from "@shared/contracts/file.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { moveDiskDocumentSource } from "./files-document-store.ts";
import {
  type DoubleClickTrack,
  detectDoubleClick,
} from "./files-double-click.ts";
import { createFilesTranslate } from "./files-i18n.ts";
import { FilesSearchBar } from "./files-search-bar.tsx";
import {
  buildGitStatusByPath,
  EMPTY_GIT_DECORATIONS,
  type FilesGitDecorations,
  ignoredStatusFor,
  splitIgnoredEntries,
} from "./files-tree-git-decorations.ts";
import { registerFilesTreeInstance } from "./files-tree-registry.ts";
import {
  getFilesTreeSnapshot,
  loadFilesTreeDirectory,
  loadFilesTreeRoot,
  moveFilesTreeEntry,
  reloadFilesTreeRoot,
  subscribeFilesTreeSession,
} from "./files-tree-store.ts";
import { ensureFilesTreeWatch } from "./files-tree-watch.ts";

const TREE_DOUBLE_CLICK_WINDOW_MS = 400;

function extractItemPathFromEvent(event: MouseEvent): string | null {
  const path = event.composedPath();
  for (const target of path) {
    if (
      target instanceof HTMLElement &&
      typeof target.dataset.itemPath === "string" &&
      target.dataset.itemPath.length > 0
    ) {
      return target.dataset.itemPath;
    }
  }
  return null;
}

interface FileTreeSidebarProps {
  activeFilePath?: string | null;
  context: RendererPluginContext;
  /** 注册表键:共享 group 视图传 groupId,内联回退传 panelId。 */
  instanceId: string;
  onOpenFile: (entry: FileEntry, options?: { pinned?: boolean }) => void;
  root: string;
}

function toTreeItem(entry: FileEntry): PierFileTreeItem {
  if (entry.kind === "directory") {
    return {
      hasChildren: "unknown",
      kind: "directory",
      path: entry.path,
    };
  }

  return {
    kind: "file",
    path: entry.path,
  };
}

function useFilesTreeSnapshot(context: RendererPluginContext, root: string) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeFilesTreeSession(root, listener),
    [root]
  );
  const getSnapshot = useCallback(() => getFilesTreeSnapshot(root), [root]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const t = useMemo(() => createFilesTranslate(context), [context]);

  useEffect(() => {
    loadFilesTreeRoot(
      root,
      context.files.list,
      t("panel.loadError.fallback", "Failed to load files")
    );
    ensureFilesTreeWatch(context, root);
  }, [context, root, t]);

  return snapshot;
}

export function FileTreeSidebar({
  activeFilePath,
  context,
  instanceId,
  onOpenFile,
  root,
}: FileTreeSidebarProps) {
  const t = useMemo(() => createFilesTranslate(context), [context]);
  const snapshot = useFilesTreeSnapshot(context, root);

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
      gitApi
        .listIgnored?.(root)
        .then((entries) => {
          if (!disposed && entries) {
            setGitDecorations((previous) => ({
              ...previous,
              ...splitIgnoredEntries(entries),
            }));
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
  }, [context, root]);

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
  const [treeSearchOpen, setTreeSearchOpen] = useState(false);
  const [treeSearchValue, setTreeSearchValue] = useState("");
  const [treeSearchFocusSignal, setTreeSearchFocusSignal] = useState(0);
  const [treeSearchMatches, setTreeSearchMatches] = useState(0);

  const openTreeSearch = useCallback(() => {
    setTreeSearchOpen(true);
    setTreeSearchFocusSignal((signal) => signal + 1);
  }, []);
  const closeTreeSearch = useCallback(() => {
    setTreeSearchOpen(false);
    setTreeSearchValue("");
    setTreeSearchMatches(0);
    treeApiRef.current?.setSearch(null);
  }, []);
  const handleTreeSearchChange = useCallback((nextValue: string) => {
    setTreeSearchValue(nextValue);
    const api = treeApiRef.current;
    if (!api) {
      return;
    }
    api.setSearch(nextValue.length > 0 ? nextValue : null);
    setTreeSearchMatches(nextValue.length > 0 ? api.getSearchMatchCount() : 0);
  }, []);
  const handleTreeSearchNavigate = useCallback(
    (direction: "next" | "previous") => {
      treeApiRef.current?.focusSearchMatch(direction);
    },
    []
  );

  useEffect(() => {
    const entry = {
      getApi: () => treeApiRef.current,
      openSearch: openTreeSearch,
      root,
    };
    return registerFilesTreeInstance(instanceId, entry);
  }, [instanceId, openTreeSearch, root]);
  const handleTreeApiRef = useCallback((api: PierFileTreeApi | null) => {
    treeApiRef.current = api;
  }, []);

  const selectedPathsRef = useRef<readonly string[]>([]);
  const handleSelectPaths = useCallback((paths: string[]) => {
    selectedPathsRef.current = paths;
  }, []);

  const loadDirectory = useCallback(
    async (path: string) => {
      await loadFilesTreeDirectory(root, path, context.files.list);
    },
    [context, root]
  );

  // 拖拽/inline rename 共用的真实 fs move + 级联;失败刷新树回滚视觉状态。
  // 成功后 toast 提供「撤销」= 反向 move(撤销本身不再叠加 toast,防循环)。
  const performMove = useCallback(
    async (from: string, to: string, options?: { silent?: boolean }) => {
      try {
        await context.files.move({ newPath: to, path: from, root });
        moveFilesTreeEntry(root, from, to);
        moveDiskDocumentSource(root, from, to);
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
      } catch (error) {
        context.notifications.error(
          error instanceof Error
            ? error.message
            : t("filePanel.tree.renameFailed", "Unable to rename")
        );
        reloadFilesTreeRoot(
          root,
          context.files.list,
          t("panel.loadError.fallback", "Failed to load files")
        );
      }
    },
    [context, root, t]
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
      if (move.from !== move.to) {
        performMove(move.from, move.to).catch(() => undefined);
      }
    },
    [performMove]
  );

  const lastOpenRef = useRef<DoubleClickTrack | null>(null);
  const openPath = useCallback(
    (path: string) => {
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
    [onOpenFile, snapshot.entriesByPath]
  );

  const handleTreeDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const path = extractItemPathFromEvent(event.nativeEvent);
      if (!path) {
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
    [onOpenFile, snapshot.entriesByPath]
  );

  const handleTreeContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const path = extractItemPathFromEvent(event.nativeEvent);
      if (!path) {
        return;
      }
      const entry = snapshot.entriesByPath.get(path);
      if (!entry) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const selection = selectedPathsRef.current;
      const selectedPaths =
        selection.length > 1 && selection.includes(entry.path)
          ? [...selection]
          : undefined;
      context.contextMenu
        .popup(
          "files/tree-item",
          { x: event.clientX, y: event.clientY },
          {
            metadata: {
              kind: entry.kind,
              path: entry.path,
              root: entry.root,
              treeId: instanceId,
              ...(selectedPaths ? { selectedPaths } : {}),
            },
          }
        )
        .catch((err: unknown) => {
          console.error("[files] tree context menu failed:", err);
        });
    },
    [context.contextMenu, instanceId, snapshot.entriesByPath]
  );

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
        directoryStates={snapshot.directoryStatesByPath}
        items={items}
        label={t("panel.tree.label", "Files")}
        onLoadDirectory={loadDirectory}
        onMovePaths={handleMovePaths}
        onOpenPath={openPath}
        onRenamePath={handleRenamePath}
        onSelectPaths={handleSelectPaths}
        revealPath={activeFilePath ?? null}
        stickyFolders
        treeApiRef={handleTreeApiRef}
      />
    );
  }

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: contextmenu bubbles from tree children; aside just captures.
    <aside
      className="flex h-full min-h-0 w-full flex-col bg-sidebar/50"
      onContextMenu={handleTreeContextMenu}
      onDoubleClick={handleTreeDoubleClick}
    >
      {/* 树头行已按目标布局移除(项目名在面包屑首段);搜索条按需出现,
          Refresh 走树右键菜单,自动刷新由 watcher 承担。 */}
      {treeSearchOpen ? (
        <div className="shrink-0 px-2 pb-1.5">
          <FilesSearchBar
            className="w-full"
            focusSignal={treeSearchFocusSignal}
            labels={{
              close: t("filePanel.search.close", "Close"),
              next: t("filePanel.search.next", "Next match"),
              placeholder: t("panel.tree.search", "Find in tree"),
              previous: t("filePanel.search.previous", "Previous match"),
            }}
            matchText={
              treeSearchValue.length > 0 ? String(treeSearchMatches) : ""
            }
            onChange={handleTreeSearchChange}
            onClose={closeTreeSearch}
            onNavigate={handleTreeSearchNavigate}
            testId="files-tree-search-bar"
            value={treeSearchValue}
          />
        </div>
      ) : null}
      {content}
    </aside>
  );
}
