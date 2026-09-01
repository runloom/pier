import type { PierFileTreeApi, PierFileTreeItem } from "@pier/ui/file/tree.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { FileEditorController } from "../editor/controller.ts";
import { createFilesTranslate } from "../i18n.ts";
import type { FilesWatchHub } from "../watch-hub.ts";
import { registerFilesTreeInstance } from "./registry.ts";
import {
  getFilesTreeSnapshot,
  loadFilesTreeRoot,
  subscribeFilesTreeSession,
} from "./store.ts";
import type { FilesTreeList } from "./visibility.ts";
import { ensureFilesTreeWatch } from "./watch.ts";

export function useRegisterFilesTreeInstance(options: {
  instanceId: string;
  openSearch: () => void;
  projectRoot?: string | null;
  root: string;
  selectedPathsRef: { readonly current: readonly string[] };
  toggleSearch: () => void;
  treeApiRef: RefObject<PierFileTreeApi | null>;
}): void {
  const {
    instanceId,
    openSearch,
    projectRoot,
    root,
    selectedPathsRef,
    toggleSearch,
    treeApiRef,
  } = options;
  useEffect(
    () =>
      registerFilesTreeInstance(instanceId, {
        collapseAll: () => treeApiRef.current?.collapseAll(),
        expandKnownDirectories: () => treeApiRef.current?.expandAll(),
        getApi: () => treeApiRef.current,
        getSelectedPaths: () => selectedPathsRef.current,
        openSearch,
        ...(projectRoot ? { projectRoot } : {}),
        root,
        toggleSearch,
      }),
    [
      instanceId,
      openSearch,
      projectRoot,
      root,
      selectedPathsRef,
      toggleSearch,
      treeApiRef,
    ]
  );
}

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
  /** Active doc from another root; rendered pinned above the tree. */
  externalActiveFile?: { path: string; root: string } | null;
  /** 注册表键:共享 group 视图传 groupId,内联回退传 panelId。 */
  instanceId: string;
  onOpenFile: (entry: FileEntry, options?: { pinned?: boolean }) => void;
  /** 可选项目路径锚点；与 root 不同时用于复制相对路径。 */
  projectRoot?: string | null;
  root: string;
  /** dockview panel id，供右键布局动作定位来源面板。 */
  sourcePanelId?: string;
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
