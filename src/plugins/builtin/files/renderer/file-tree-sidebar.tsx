import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { PierFileTree, type PierFileTreeItem } from "@pier/ui/file-tree.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { createFilesTranslate } from "./files-i18n.ts";
import {
  getFilesTreeSnapshot,
  loadFilesTreeDirectory,
  loadFilesTreeRoot,
  subscribeFilesTreeSession,
} from "./files-tree-store.ts";

const TREE_COLLAPSED_STORAGE_PREFIX = "pier.files.filePanel.treeCollapsed:";

interface FileTreeSidebarProps {
  collapsed: boolean;
  context: RendererPluginContext;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpenFile: (entry: FileEntry) => void;
  root: string | null;
}

function treePreferenceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function treePreferenceKey(root: string): string {
  return `${TREE_COLLAPSED_STORAGE_PREFIX}${root}`;
}

function readTreeCollapsed(root: string | null): boolean {
  if (!root) {
    return false;
  }
  return treePreferenceStorage()?.getItem(treePreferenceKey(root)) === "true";
}

function writeTreeCollapsed(root: string, collapsed: boolean): void {
  treePreferenceStorage()?.setItem(treePreferenceKey(root), String(collapsed));
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

function useFilesTreeSnapshot(
  context: RendererPluginContext,
  root: string | null,
  enabled: boolean
) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeFilesTreeSession(root, listener),
    [root]
  );
  const getSnapshot = useCallback(() => getFilesTreeSnapshot(root), [root]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const t = useMemo(() => createFilesTranslate(context), [context]);

  useEffect(() => {
    if (!(root && enabled)) {
      return;
    }
    loadFilesTreeRoot(
      root,
      context.files.list,
      t("panel.loadError.fallback", "Failed to load files")
    );
  }, [context, enabled, root, t]);

  return snapshot;
}

export function filePanelProjectRoot(
  context: PanelContext | null | undefined
): string | null {
  return (
    context?.projectRootPath ??
    context?.worktreeRoot ??
    context?.gitRoot ??
    context?.cwd ??
    context?.openedPath ??
    null
  );
}

export function useProjectFileTreeCollapsed(
  root: string | null
): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsedState] = useState(() =>
    readTreeCollapsed(root)
  );

  useEffect(() => {
    setCollapsedState(readTreeCollapsed(root));
  }, [root]);

  const setCollapsed = useCallback(
    (nextCollapsed: boolean) => {
      setCollapsedState(nextCollapsed);
      if (root) {
        writeTreeCollapsed(root, nextCollapsed);
      }
    },
    [root]
  );

  return [collapsed, setCollapsed];
}

export function FileTreeSidebar({
  collapsed,
  context,
  onCollapsedChange,
  onOpenFile,
  root,
}: FileTreeSidebarProps) {
  const t = useMemo(() => createFilesTranslate(context), [context]);
  const snapshot = useFilesTreeSnapshot(context, root, !collapsed);
  const items = useMemo<PierFileTreeItem[]>(
    () => [...snapshot.entriesByPath.values()].map(toTreeItem),
    [snapshot.entriesByPath]
  );

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!root) {
        return;
      }
      await loadFilesTreeDirectory(root, path, context.files.list);
    },
    [context, root]
  );

  const openPath = useCallback(
    (path: string) => {
      const entry = snapshot.entriesByPath.get(path);
      if (entry?.kind === "file") {
        onOpenFile(entry);
      }
    },
    [onOpenFile, snapshot.entriesByPath]
  );

  if (!root) {
    return null;
  }

  let content: ReactNode = null;
  if (!collapsed) {
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
          onOpenPath={openPath}
        />
      );
    }
  }

  return (
    <aside
      className={
        collapsed
          ? "flex h-full min-h-0 w-12 shrink-0 flex-col border-border border-r bg-muted/20"
          : "flex h-full min-h-0 w-72 shrink-0 flex-col border-border border-r bg-muted/20"
      }
    >
      <div className="flex items-center justify-between gap-2 border-border border-b px-3 py-2">
        {collapsed ? null : (
          <span className="truncate font-medium text-muted-foreground text-xs">
            {t("panel.title", "Files")}
          </span>
        )}
        <Button
          aria-label={
            collapsed
              ? t("filePanel.tree.expand", "Expand file tree")
              : t("filePanel.tree.collapse", "Collapse file tree")
          }
          onClick={() => onCollapsedChange(!collapsed)}
          size="xs"
          type="button"
          variant="ghost"
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" />
          ) : (
            <PanelLeftClose aria-hidden="true" />
          )}
          <span className="sr-only">
            {collapsed
              ? t("filePanel.tree.expand", "Expand file tree")
              : t("filePanel.tree.collapse", "Collapse file tree")}
          </span>
        </Button>
      </div>
      {collapsed ? null : content}
    </aside>
  );
}
