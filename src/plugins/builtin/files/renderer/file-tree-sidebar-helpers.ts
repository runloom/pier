import type { PierFileTreeItem } from "@pier/ui/file-tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { FileEditorController } from "./file-editor-controller.ts";
import { createFilesTranslate } from "./files-i18n.ts";
import {
  getFilesTreeSnapshot,
  loadFilesTreeRoot,
  subscribeFilesTreeSession,
} from "./files-tree-store.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";
import { ensureFilesTreeWatch } from "./files-tree-watch.ts";
import type { FilesWatchHub } from "./files-watch-hub.ts";

export function extractItemPathFromEvent(event: MouseEvent): string | null {
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

export interface FileTreeSidebarProps {
  activeFilePath?: string | null;
  context: RendererPluginContext;
  controller: FileEditorController;
  /** 注册表键:共享 group 视图传 groupId,内联回退传 panelId。 */
  instanceId: string;
  onOpenFile: (entry: FileEntry, options?: { pinned?: boolean }) => void;
  root: string;
  watchHub: FilesWatchHub;
}

export function toTreeItem(entry: FileEntry): PierFileTreeItem {
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

export function useFilesTreeSnapshot(
  context: RendererPluginContext,
  root: string,
  watchHub: FilesWatchHub,
  list: FilesTreeList
) {
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
      list,
      t("panel.loadError.fallback", "Failed to load files")
    );
    ensureFilesTreeWatch(context, watchHub, root, list);
  }, [context, list, root, t, watchHub]);

  return snapshot;
}
