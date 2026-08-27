import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  isProjectCanvasPath,
  liveModuleProjectContentDirectories,
  normalizeProjectRootKey,
} from "@shared/live-module-canvas-path.ts";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { refreshDiskDocumentLanguagesForProject } from "../document/store.ts";
import type {
  FilesDocumentPanelSource,
  FileViewMode,
} from "../document/types.ts";
import { parseFilesDocumentPanelSource } from "../document/types.ts";
import { useFilesDocument } from "../document/use-document.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { createFileEditorSessionId } from "../editor/session-id.ts";
import { createFilesTranslate } from "../i18n.ts";
import {
  ensureLiveModulesProjectConfigLoaded,
  subscribeLiveModulesProjectConfigChanged,
} from "../preview/load-live-modules-config.ts";
import {
  activeFilePathForTree,
  filePanelProjectRoot,
  projectNameFromRoot,
  useProjectFileTreeCollapsed,
} from "../tree/preferences.ts";
import {
  openFilesTreeSearch,
  toggleFilesTreeSearch,
} from "../tree/registry.ts";
import { FileTreeSidebar } from "../tree/sidebar.tsx";
import type { FilesWatchHub } from "../watch-hub.ts";
import { ResolvedFilePanelActions } from "./actions.tsx";
import { ResolvedFilePanel } from "./body.tsx";
import { filesBreadcrumbContextMenuHandler } from "./breadcrumb-context-menu.ts";
import { revealDiskBreadcrumbInTree } from "./breadcrumb-reveal.ts";
import { useActiveFilesPanel } from "./group-active-panel.ts";
import {
  EmptyFileState,
  FilePanelBreadcrumb,
  FilePanelChrome,
  FilePanelSearchButton,
  FilePanelShell,
  OutsideWorkspaceBanner,
  ReadOnlyErrorState,
  SidebarToggleButton,
} from "./parts.tsx";
import {
  breadcrumbSegmentsForSource,
  outsideWorkspaceStateFor,
} from "./source.ts";
import {
  peekFilesPanelViewSeed,
  rememberFilesPanelViewMode,
  subscribeFilesPanelViewSeed,
  takeFilesPanelViewSeed,
} from "./transfer-state.ts";
import { useFilesGroupNav } from "./use-group-nav.ts";
import {
  defaultModeForSource,
  persistPreviewOpenMode,
} from "./use-transfer-view.ts";

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
        markdownRevealLine?: number;
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
        markdownRevealLine: activeParams?.markdownRevealLine,
        panelId: activePanel.id,
        pinned: activeParams?.pinned === true,
        source: parsedSource,
      }
    : null;
  const editorSessionId = activeTab
    ? createFileEditorSessionId(activeTab.panelId)
    : null;

  const panelContext = activeTab?.context;
  const root = filePanelProjectRoot(panelContext);
  const [treeCollapsed, setTreeCollapsed] = useProjectFileTreeCollapsed(root);
  const projectName = root ? projectNameFromRoot(root) : null;
  const [modeByDocumentId, setModeByDocumentId] = useState<
    ReadonlyMap<string, FileViewMode>
  >(() => new Map());
  const [searchRequest, setSearchRequest] = useState(0);
  /** Bump after live-modules config loads so canvas path checks re-run. */
  const [liveModulesConfigEpoch, setLiveModulesConfigEpoch] = useState(0);

  useEffect(() => {
    if (!root) {
      return;
    }
    let cancelled = false;
    const bump = () => {
      if (!cancelled) {
        setLiveModulesConfigEpoch((value) => value + 1);
      }
    };
    ensureLiveModulesProjectConfigLoaded(root)
      .then(bump)
      .catch(() => undefined);
    const rootKey = normalizeProjectRootKey(root);
    const unsubscribe = subscribeLiveModulesProjectConfigChanged(
      (changedRoot) => {
        if (normalizeProjectRootKey(changedRoot) !== rootKey) {
          return;
        }
        refreshDiskDocumentLanguagesForProject(root);
        ensureLiveModulesProjectConfigLoaded(root)
          .then(bump)
          .catch(() => undefined);
      }
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [root]);

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
  const mode = (() => {
    const stored = documentKey ? modeByDocumentId.get(documentKey) : undefined;
    if (stored) {
      return stored;
    }
    if (
      selectedDocument?.language === "markdown" ||
      selectedDocument?.language === "html" ||
      selectedDocument?.language === "svg"
    ) {
      return defaultModeForSource(selectedSource, selectedDocument.language);
    }
    // liveModulesConfigEpoch in the guard forces re-eval after config load/save.
    if (!root || liveModulesConfigEpoch < 0) {
      return "source";
    }
    const contentDirectories = liveModuleProjectContentDirectories(root);
    const isCanvas =
      selectedDocument?.language === "canvas" ||
      (selectedSource?.kind === "disk" &&
        isProjectCanvasPath(selectedSource.path, contentDirectories));
    return isCanvas ? "preview" : "source";
  })();

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
      persistPreviewOpenMode(selectedDocument?.language, nextMode);
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
    // take（而非 peek）：panelId 种子只应施加一次，否则每次切回该 tab
    // 都会把传输捕获的模式强加回用户选择之上。
    const seed = takeFilesPanelViewSeed({
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
        // 事件到达时消费 panelId 种子，避免后续 tab 切换重复施加。
        const consumed = takeFilesPanelViewSeed({ panelId });
        writeMode((consumed ?? event.view).mode, panelId);
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

  const { handleOpenFileFromTree } = useFilesGroupNav({
    context,
    groupId,
    panelContext,
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

  const activeFilePath = activeFilePathForTree({
    root,
    source: selectedSource,
  });

  const { externalActiveFile, outsideWorkspace } = outsideWorkspaceStateFor(
    selectedSource,
    root,
    panelContext
  );

  const sidebar =
    root && !treeCollapsed ? (
      <FileTreeSidebar
        activeFilePath={activeFilePath}
        context={context}
        controller={controller}
        {...(externalActiveFile ? { externalActiveFile } : {})}
        instanceId={groupId}
        onOpenFile={handleOpenFileFromTree}
        {...(panelContext?.projectRootPath
          ? { projectRoot: panelContext.projectRootPath }
          : {})}
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
            ? t("filePanel.tree.action.search", "Find in File Tree")
            : t("filePanel.search", "Find in file")
        }
        onOpenSearch={handleOpenSearch}
        t={t}
      />
    </>
  );

  const breadcrumbContextMenu = filesBreadcrumbContextMenuHandler({
    context,
    ...(panelContext ? { panelContext } : {}),
    ...(activeTab?.panelId ? { panelId: activeTab.panelId } : {}),
    source: selectedSource,
    t,
  });

  let center: ReactNode;
  let trailing: ReactNode = null;
  let body: ReactNode;

  if (outsideWorkspace && selectedSource) {
    center = (
      <FilePanelBreadcrumb
        ariaLabel={t("filePanel.breadcrumbLabel", "File location")}
        {...(breadcrumbContextMenu
          ? { onContextMenu: breadcrumbContextMenu }
          : {})}
        segments={breadcrumbSegmentsForSource(selectedSource, projectName)}
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
  } else if (selectedSource && editorSessionId) {
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
        {...(breadcrumbContextMenu
          ? { onContextMenu: breadcrumbContextMenu }
          : {})}
        onSegmentClick={handleBreadcrumbClick}
        segments={breadcrumbSegmentsForSource(selectedSource, projectName)}
      />
    );
    trailing = (
      <ResolvedFilePanelActions
        context={context}
        controller={controller}
        editorSessionId={editorSessionId}
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
      <div className="flex h-full min-h-0 flex-col">
        {outsideWorkspace ? (
          <OutsideWorkspaceBanner
            context={context}
            path={selectedSource.kind === "disk" ? selectedSource.path : ""}
            root={selectedSource.kind === "disk" ? selectedSource.root : ""}
            t={t}
          />
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">
          <ResolvedFilePanel
            context={context}
            controller={controller}
            editorSessionId={editorSessionId}
            markdownAnchor={activeTab?.markdownAnchor}
            markdownAnchorRequestId={activeTab?.markdownAnchorRequestId}
            markdownRevealLine={activeTab?.markdownRevealLine}
            mode={mode}
            onModeChange={setMode}
            panelContext={panelContext}
            panelId={activeTab?.panelId}
            searchRequest={searchRequest}
            source={selectedSource}
            t={t}
          />
        </div>
      </div>
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
