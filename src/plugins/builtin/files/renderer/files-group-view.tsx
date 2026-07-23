import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { FileEditorController } from "./file-editor-controller.ts";
import { ResolvedFilePanelActions } from "./file-panel-actions.tsx";
import { ResolvedFilePanel } from "./file-panel-body.tsx";
import { revealDiskBreadcrumbInTree } from "./file-panel-breadcrumb-reveal.ts";
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
  breadcrumbSegmentsForSource,
  sourceTitle,
} from "./file-panel-source.ts";
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
} from "./files-document-types.ts";
import { useActiveFilesPanel } from "./files-group-active-panel.ts";
import { createFilesTranslate } from "./files-i18n.ts";
import {
  peekFilesPanelViewSeed,
  rememberFilesPanelViewMode,
  subscribeFilesPanelViewSeed,
} from "./files-panel-transfer-state.ts";
import {
  openFilesTreeSearch,
  toggleFilesTreeSearch,
} from "./files-tree-registry.ts";
import type { FilesWatchHub } from "./files-watch-hub.ts";
import {
  readMarkdownOpenMode,
  writeMarkdownOpenMode,
} from "./markdown-preview-preferences.ts";
import { useFilesDocument } from "./use-files-document.ts";
import { useFilesGroupNav } from "./use-files-group-nav.ts";

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
          "This file tab could not be restored."
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
  const selectedDocumentId = selectedSource
    ? controller.documentId(selectedSource)
    : null;
  const selectedDocument = useFilesDocument(selectedDocumentId ?? "");
  const mode =
    (documentKey ? modeByDocumentId.get(documentKey) : undefined) ??
    (selectedDocument?.language === "markdown"
      ? readMarkdownOpenMode()
      : "source");

  const writeMode = useCallback(
    (nextMode: FileViewMode, panelId: string | undefined) => {
      if (!documentKey) {
        return;
      }
      setModeByDocumentId((previous) => {
        if (previous.get(documentKey) === nextMode) {
          return previous;
        }
        return new Map(previous).set(documentKey, nextMode);
      });
      if (panelId) {
        rememberFilesPanelViewMode(panelId, nextMode);
      }
      if (
        selectedDocument?.language === "markdown" &&
        (nextMode === "preview" || nextMode === "source")
      ) {
        writeMarkdownOpenMode(nextMode);
      }
    },
    [documentKey, selectedDocument?.language]
  );

  const setMode = useCallback(
    (nextMode: FileViewMode) => {
      writeMode(nextMode, activeTab?.panelId);
    },
    [activeTab?.panelId, writeMode]
  );

  useLayoutEffect(() => {
    const panelId = activeTab?.panelId;
    if (!(panelId && documentKey && selectedSource)) {
      return;
    }
    const seed = peekFilesPanelViewSeed({
      panelId,
      documentId: controller.documentId(selectedSource),
    });
    if (!seed) {
      return;
    }
    writeMode(seed.mode, panelId);
  }, [activeTab?.panelId, controller, documentKey, selectedSource, writeMode]);

  useEffect(
    () =>
      subscribeFilesPanelViewSeed((event) => {
        const panelId = activeTab?.panelId;
        if (!(panelId && documentKey && selectedSource)) {
          return;
        }
        const documentId = controller.documentId(selectedSource);
        const matchesPanel = event.panelId === panelId;
        const matchesDocument = event.documentId === documentId;
        if (!(matchesPanel || matchesDocument)) {
          return;
        }
        writeMode(event.view.mode, panelId);
      }),
    [activeTab?.panelId, controller, documentKey, selectedSource, writeMode]
  );

  useEffect(() => {
    const panelId = activeTab?.panelId;
    if (!panelId) {
      return;
    }
    const seed = peekFilesPanelViewSeed({
      panelId,
      ...(selectedDocumentId ? { documentId: selectedDocumentId } : {}),
    });
    if (seed && seed.mode !== mode) {
      return;
    }
    rememberFilesPanelViewMode(panelId, mode);
  }, [activeTab?.panelId, mode, selectedDocumentId]);

  const {
    canBack,
    canForward,
    handleNavBack,
    handleNavForward,
    handleOpenFileFromTree,
  } = useFilesGroupNav({
    context,
    groupId,
    panelContext,
    selectedSource,
  });

  // chrome 🔍:树可用时切换树内搜索(折叠先展开,等挂载再聚焦);
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
    toggleFilesTreeSearch({ instanceId: groupId, root });
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
        {...(activeTab?.panelId ? { sourcePanelId: activeTab.panelId } : {})}
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
          "This file is outside the current workspace and cannot be restored."
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
      revealDiskBreadcrumbInTree({
        context,
        index,
        instanceId: groupId,
        path: selectedSource.path,
        projectName,
        root,
        setTreeCollapsed,
        source: selectedSource,
        treeCollapsed,
      });
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
        onModeChange={setMode}
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
