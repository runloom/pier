import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import type { FileEditorController } from "./file-editor-controller.ts";
import { ResolvedFilePanelActions } from "./file-panel-actions.tsx";
import { ResolvedFilePanel } from "./file-panel-body.tsx";
import { createFileFilePanelInstanceId } from "./file-panel-id.ts";
import {
  EmptyFileState,
  FilePanelBreadcrumb,
  FilePanelChrome,
  FilePanelNavButtons,
  FilePanelSearchButton,
  FilePanelShell,
  ReadOnlyErrorState,
  SidebarToggleButton,
} from "./file-panel-parts.tsx";
import {
  filePanelProjectRoot,
  projectNameFromRoot,
  useProjectFileTreeCollapsed,
} from "./file-tree-preferences.ts";
import { FileTreeSidebar } from "./file-tree-sidebar.tsx";
import type {
  FilesDocumentPanelSource,
  FileViewMode,
} from "./files-document-types.ts";
import {
  isDiskSourceRootAllowed,
  parseFilesDocumentPanelSource,
  sameFilesDocumentPanelSource,
} from "./files-document-types.ts";
import { useActiveFilesPanel } from "./files-group-active-panel.ts";
import { createFilesTranslate } from "./files-i18n.ts";
import {
  filesNavBack,
  filesNavForward,
  getFilesNavState,
  pushFilesNavEntry,
  subscribeFilesNavHistory,
} from "./files-nav-history.ts";
import {
  openFilesTreeSearch,
  revealFilesTreePath,
} from "./files-tree-registry.ts";
import type { FilesWatchHub } from "./files-watch-hub.ts";

function sourceTitle(source: FilesDocumentPanelSource): string {
  if (source.kind === "untitled") {
    return source.name;
  }
  return source.path.split("/").filter(Boolean).at(-1) ?? source.path;
}

function breadcrumbSegmentsForSource(
  source: FilesDocumentPanelSource,
  projectName: string | null
): string[] {
  if (source.kind === "untitled") {
    return [source.name];
  }
  const parts = source.path.split("/").filter(Boolean);
  if (projectName && projectName.length > 0) {
    return [projectName, ...parts];
  }
  return parts;
}

export function FilesGroupView({
  context,
  controller,
  group,
  watchHub,
}: {
  context: RendererPluginContext;
  controller: FileEditorController;
  group: PierDockviewGroupHandle;
  watchHub: FilesWatchHub;
}) {
  const groupId = group.id;
  const t = useMemo(() => createFilesTranslate(context), [context]);
  const activePanel = useActiveFilesPanel(group);
  const activeParams = activePanel?.params as
    | {
        context?: PanelContext;
        markdownAnchor?: string;
        markdownAnchorRequestId?: string;
        pinned?: boolean;
        source?: unknown;
      }
    | undefined;
  const parsedSource = parseFilesDocumentPanelSource(activeParams);
  const hasRawSource =
    activeParams != null &&
    "source" in activeParams &&
    activeParams.source != null;
  const activeTab = activePanel
    ? {
        context: activeParams?.context,
        markdownAnchor: activeParams?.markdownAnchor,
        markdownAnchorRequestId: activeParams?.markdownAnchorRequestId,
        panelId: activePanel.id,
        pinned: activeParams?.pinned === true,
        source: parsedSource,
      }
    : null;

  const panelContext = activeTab?.context;
  const root = filePanelProjectRoot(panelContext);
  const [treeCollapsed, setTreeCollapsed] = useProjectFileTreeCollapsed(root);
  const projectName = root ? projectNameFromRoot(root) : null;
  const [modeByDocumentId, setModeByDocumentId] = useState<
    ReadonlyMap<string, FileViewMode>
  >(() => new Map());
  const [searchRequest, setSearchRequest] = useState(0);

  // invalid 区分:params 有 source 字段但解析失败 → 显示错误态而非空态。
  const sourceState = useMemo<
    | { kind: "empty" }
    | { kind: "invalid"; message: string; title: string }
    | { kind: "source"; source: FilesDocumentPanelSource }
  >(() => {
    if (activeTab?.source) {
      return { kind: "source", source: activeTab.source };
    }
    if (hasRawSource) {
      return {
        kind: "invalid",
        message: t(
          "filePanel.errors.invalidParams",
          "The saved panel parameters are invalid."
        ),
        title: t("filePanel.title", "File"),
      };
    }
    return { kind: "empty" };
  }, [activeTab?.source, hasRawSource, t]);
  const selectedSource =
    sourceState.kind === "source" ? sourceState.source : null;
  let documentKey: string | null = null;
  if (selectedSource?.kind === "untitled") {
    documentKey = selectedSource.id;
  } else if (selectedSource) {
    documentKey = `${selectedSource.root}\0${selectedSource.path}`;
  }
  const mode =
    (documentKey ? modeByDocumentId.get(documentKey) : undefined) ?? "source";

  const setMode = useCallback(
    (nextMode: FileViewMode) => {
      if (!documentKey) {
        return;
      }
      setModeByDocumentId((previous) => {
        if (previous.get(documentKey) === nextMode) {
          return previous;
        }
        return new Map(previous).set(documentKey, nextMode);
      });
    },
    [documentKey]
  );

  const navSubscribe = useCallback(
    (listener: () => void) => subscribeFilesNavHistory(groupId, listener),
    [groupId]
  );
  const navSnapshot = useCallback(
    () => JSON.stringify(getFilesNavState(groupId)),
    [groupId]
  );
  useSyncExternalStore(navSubscribe, navSnapshot, navSnapshot);
  const { canBack, canForward } = getFilesNavState(groupId);

  useEffect(() => {
    if (selectedSource) {
      pushFilesNavEntry(groupId, selectedSource);
    }
  }, [groupId, selectedSource]);

  const openSourceInGroup = useCallback(
    (source: FilesDocumentPanelSource, options: { pinned: boolean }) => {
      const existingInstance = context.panels
        .listInstances(FILES_FILE_PANEL_ID)
        .find(
          (instance) =>
            instance.groupId === groupId &&
            sameFilesDocumentPanelSource(
              parseFilesDocumentPanelSource(instance.params),
              source
            )
        );
      const existingSource = parseFilesDocumentPanelSource(
        existingInstance?.params
      );
      const existingParams = existingInstance?.params
        ? { ...existingInstance.params }
        : null;
      const params = existingParams
        ? {
            ...existingParams,
            ...(options.pinned ? { pinned: true } : {}),
          }
        : {
            pinned: options.pinned,
            source,
          };

      context.panels.openInstance({
        componentId: FILES_FILE_PANEL_ID,
        ...(!existingInstance && panelContext ? { context: panelContext } : {}),
        dropUnpinnedInstances: existingInstance ? false : !options.pinned,
        instanceId:
          existingInstance?.id ?? createFileFilePanelInstanceId(source),
        params,
        targetGroupId: groupId,
        title: sourceTitle(existingSource ?? source),
      });
    },
    [context, groupId, panelContext]
  );

  const openNavSource = useCallback(
    (source: FilesDocumentPanelSource | null) => {
      if (!source) {
        return;
      }
      openSourceInGroup(source, { pinned: false });
    },
    [openSourceInGroup]
  );

  const handleNavBack = useCallback(() => {
    openNavSource(filesNavBack(groupId));
  }, [groupId, openNavSource]);
  const handleNavForward = useCallback(() => {
    openNavSource(filesNavForward(groupId));
  }, [groupId, openNavSource]);

  const handleOpenFileFromTree = useCallback(
    (entry: FileEntry, options?: { pinned?: boolean }) => {
      const nextSource: FilesDocumentPanelSource = {
        kind: "disk",
        path: entry.path,
        root: entry.root,
      };
      const pinned = options?.pinned === true;
      openSourceInGroup(nextSource, { pinned });
    },
    [openSourceInGroup]
  );

  // chrome 🔍:树可用时打开树内搜索(折叠先展开,等挂载再聚焦);
  // 无项目树(如终端 Markdown 草稿)退回编辑器内查找。
  const handleOpenSearch = useCallback(() => {
    if (!root) {
      setSearchRequest((request) => request + 1);
      return;
    }
    if (treeCollapsed) {
      setTreeCollapsed(false);
      setTimeout(() => {
        openFilesTreeSearch({ instanceId: groupId, root });
      }, 80);
      return;
    }
    openFilesTreeSearch({ instanceId: groupId, root });
  }, [groupId, root, setTreeCollapsed, treeCollapsed]);

  const activeFilePath =
    selectedSource?.kind === "disk" && selectedSource.root === root
      ? selectedSource.path
      : null;

  const sidebar =
    root && !treeCollapsed ? (
      <FileTreeSidebar
        activeFilePath={activeFilePath}
        context={context}
        controller={controller}
        instanceId={groupId}
        onOpenFile={handleOpenFileFromTree}
        root={root}
        watchHub={watchHub}
      />
    ) : null;

  const chromeLeading = (
    <>
      <SidebarToggleButton
        collapsed={treeCollapsed}
        hidden={!root}
        onToggle={() => setTreeCollapsed(!treeCollapsed)}
        t={t}
      />
      <FilePanelSearchButton
        label={
          root
            ? t("panel.tree.search", "Find in tree")
            : t("filePanel.search", "Find in file")
        }
        onOpenSearch={handleOpenSearch}
        t={t}
      />
      <FilePanelNavButtons
        canBack={canBack}
        canForward={canForward}
        onBack={handleNavBack}
        onForward={handleNavForward}
        t={t}
      />
    </>
  );

  const outsideWorkspace =
    selectedSource?.kind === "disk" &&
    !isDiskSourceRootAllowed(selectedSource.root, panelContext);

  let center: ReactNode;
  let trailing: ReactNode = null;
  let body: ReactNode;

  if (outsideWorkspace && selectedSource) {
    center = (
      <FilePanelBreadcrumb
        ariaLabel={t("filePanel.breadcrumbLabel", "File location")}
        segments={breadcrumbSegmentsForSource(selectedSource, projectName)}
      />
    );
    body = (
      <ReadOnlyErrorState
        message={t(
          "filePanel.errors.outsideWorkspace",
          "This file source is outside the restored workspace context."
        )}
        t={t}
        title={sourceTitle(selectedSource)}
      />
    );
  } else if (sourceState.kind === "invalid") {
    center = (
      <span className="truncate font-mono text-muted-foreground text-xs">
        {sourceState.title}
      </span>
    );
    body = (
      <ReadOnlyErrorState
        message={sourceState.message}
        t={t}
        title={sourceState.title}
      />
    );
  } else if (selectedSource) {
    const handleBreadcrumbClick = (index: number) => {
      if (!root || selectedSource.kind !== "disk") {
        return;
      }
      // segments = [projectName, ...pathParts];index 0 = 项目根,
      // 中间段 = 目录,最后段 = 文件本身。
      const pathParts = selectedSource.path.split("/").filter(Boolean);
      const targetPath = pathParts.slice(0, index).join("/");
      const revealTarget = targetPath || selectedSource.path;
      if (treeCollapsed) {
        setTreeCollapsed(false);
        // 树刚展开,等挂载完成再定位。
        setTimeout(() => {
          revealFilesTreePath({
            instanceId: groupId,
            path: revealTarget,
            root,
          });
        }, 80);
        return;
      }
      revealFilesTreePath({ instanceId: groupId, path: revealTarget, root });
    };
    center = (
      <FilePanelBreadcrumb
        ariaLabel={t("filePanel.breadcrumbLabel", "File location")}
        onSegmentClick={handleBreadcrumbClick}
        segments={breadcrumbSegmentsForSource(selectedSource, projectName)}
      />
    );
    trailing = (
      <ResolvedFilePanelActions
        controller={controller}
        mode={mode}
        onModeChange={setMode}
        panelId={activeTab?.panelId}
        source={selectedSource}
        t={t}
      />
    );
    // dockview params 的唯一写者是薄壳(它持有完整 props.params:context/
    // pinned/dirty/source)。共享视图侧绝不回写 —— 曾用 {pinned,source} 局部
    // 快照覆盖过完整 params,丢 context 导致面板落入 outside-workspace 错误态。
    body = (
      <ResolvedFilePanel
        context={context}
        controller={controller}
        markdownAnchor={activeTab?.markdownAnchor}
        markdownAnchorRequestId={activeTab?.markdownAnchorRequestId}
        mode={mode}
        panelContext={panelContext}
        panelId={activeTab?.panelId}
        searchRequest={searchRequest}
        source={selectedSource}
        t={t}
      />
    );
  } else {
    center = (
      <span className="truncate font-mono text-muted-foreground text-xs">
        {projectName ?? t("filePanel.title", "File")}
      </span>
    );
    body = <EmptyFileState hasProjectTree={Boolean(root)} t={t} />;
  }

  // 始终复用同一 FilePanelShell + sidebar 槽位,切 empty↔source 时树不 remount。
  return (
    <FilePanelShell
      header={
        <FilePanelChrome
          center={center}
          leading={chromeLeading}
          trailing={trailing}
        />
      }
      onSidebarAutoCollapse={() => setTreeCollapsed(true)}
      sidebar={sidebar}
    >
      {body}
    </FilePanelShell>
  );
}
