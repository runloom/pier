import { usePanelFindSearchRequest as useFindRequest } from "@plugins/api/panel-find.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  IDockviewPanelProps,
  PierDockviewGroupHandle,
} from "@shared/contracts/dockview.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import {
  type FilesDocumentPanelSource,
  sameFilesDocumentPanelSource,
} from "../document/types.ts";
import { useFilesDocument } from "../document/use-document.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { createFileEditorSessionId } from "../editor/session-id.ts";
import { createFilesTranslate, useFilesPluginLanguage } from "../i18n.ts";
import {
  activeFilePathForTree,
  filePanelProjectRoot,
  projectNameFromRoot,
  useProjectFileTreeCollapsed,
} from "../tree/preferences.ts";
import type { FilesWatchHub } from "../watch-hub.ts";
import { ResolvedFilePanelActions } from "./actions.tsx";
import { ResolvedFilePanel } from "./body.tsx";
import { filesBreadcrumbContextMenuHandler } from "./breadcrumb-context-menu.ts";
import { revealDiskBreadcrumbInTree } from "./breadcrumb-reveal.ts";
import { createFileFilePanelInstanceId } from "./id.ts";
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
import { renderFilePanelSidebar } from "./sidebar-slot.tsx";
import {
  asGroupHandle,
  breadcrumbSegmentsForPanelSource,
  outsideWorkspaceStateFor,
  panelSourceForDocument,
  parseSourceState,
} from "./source.ts";
import { fileDocumentShowsUnsavedMark } from "./tab/unsaved.ts";
import type { FilePanelRuntimeProps } from "./types.ts";
import { useFilesGroupViewClaim } from "./use-group-view-claim.ts";
import { useFilesPanelRemoveClose } from "./use-remove-panel-close.ts";
import { useFilePanelSaveAs } from "./use-save-as.ts";
import { useFilesPanelTransferView } from "./use-transfer-view.ts";

let nextInlinePanelSessionId = 1;
function FilePanelContent({
  runtimeController,
  runtimeContext,
  runtimeWatchHub,
  ...props
}: FilePanelRuntimeProps) {
  const controller = runtimeController;
  // Locale switch must rebuild `t` so memoized children re-resolve copy.
  const language = useFilesPluginLanguage();
  const t = useMemo(
    () => createFilesTranslate(runtimeContext, language),
    [language, runtimeContext]
  );
  const sourceState = useMemo(
    () => parseSourceState(props.params, t),
    [props.params, t]
  );
  const sourceFromParams =
    sourceState.kind === "source" ? sourceState.source : null;
  const stableSourceRef = useRef<FilesDocumentPanelSource | null>(null);
  if (
    sourceFromParams &&
    !sameFilesDocumentPanelSource(stableSourceRef.current, sourceFromParams)
  ) {
    stableSourceRef.current = sourceFromParams;
  } else if (!sourceFromParams) {
    stableSourceRef.current = null;
  }
  const stableSource = stableSourceRef.current;
  const [searchRequest, setSearchRequest] = useFindRequest(props.api?.id);
  const root = filePanelProjectRoot(props.params?.context);
  const [treeCollapsed, setTreeCollapsed] = useProjectFileTreeCollapsed(root);
  const projectName = root ? projectNameFromRoot(root) : null;
  const panelSessionIdRef = useRef<string | null>(null);
  panelSessionIdRef.current ??= `inline-panel:${nextInlinePanelSessionId++}`;
  const panelSessionId = props.api?.id ?? panelSessionIdRef.current;
  const editorSessionId = createFileEditorSessionId(panelSessionId);
  const trackedDocumentIdForMode = stableSource
    ? controller.documentId(stableSource)
    : null;
  const trackedDocumentForMode = useFilesDocument(
    trackedDocumentIdForMode ?? ""
  );
  const { mode, setMode } = useFilesPanelTransferView({
    controller,
    language: trackedDocumentForMode?.language,
    panelSessionId,
    stableSource,
  });
  useLayoutEffect(() => {
    if (!stableSource) return;
    return controller.acquirePanel(panelSessionId, stableSource);
  }, [controller, panelSessionId, stableSource]);

  // group 绑定必须活着：跨组拖拽不 remount，只 reparent。render 快照会指向旧组。
  // onDidGroupChange 把 groupId 提升为 state，cleanup/setup 对称完成迁移。
  const [group, setGroup] = useState<PierDockviewGroupHandle | null>(() =>
    asGroupHandle(props.api?.group)
  );
  useEffect(() => {
    setGroup(asGroupHandle(props.api?.group));
    const disposable = props.api?.onDidGroupChange?.(() => {
      setGroup(asGroupHandle(props.api?.group));
    });
    return () => {
      disposable?.dispose?.();
    };
  }, [props.api]);
  useFilePanelSaveAs({
    controller,
    group,
    props,
    runtimeContext,
    stableSource,
  });
  const ownerIdRef = useRef<symbol | null>(null);
  if (ownerIdRef.current === null) {
    ownerIdRef.current = Symbol(props.api?.id ?? "inline");
  }
  const prefersSharedGroupView = Boolean(
    runtimeContext && group && props.api?.id && ownerIdRef.current
  );
  useFilesGroupViewClaim({
    controller,
    group,
    ownerId: ownerIdRef.current,
    panelApiId: props.api?.id,
    prefersSharedGroupView,
    runtimeContext,
    runtimeWatchHub,
  });
  const inlineUntitledDocumentId =
    !prefersSharedGroupView && sourceFromParams?.kind === "untitled"
      ? sourceFromParams.id
      : null;
  useEffect(() => {
    if (!inlineUntitledDocumentId) {
      return;
    }
    return () => {
      controller.discardDocument(inlineUntitledDocumentId);
    };
  }, [controller, inlineUntitledDocumentId]);

  // tab 未保存圆点:dirty 或尚未落盘的 untitled(needsSaveAs) 写进 params,
  // panel-tab-header 经 onDidParametersChange 收到后渲染。preview→pinned
  // 只看 content dirty，避免空 untitled 一打开就被钉死。
  const trackedDocumentId = sourceFromParams
    ? controller.documentId(sourceFromParams)
    : null;
  const trackedDocument = useFilesDocument(trackedDocumentId ?? "");
  const trackedSource = panelSourceForDocument(trackedDocument);
  const trackedDirty = trackedDocument?.dirty === true;
  const trackedUnsaved = fileDocumentShowsUnsavedMark({
    dirty: trackedDirty,
    needsSaveAs: trackedDocument?.needsSaveAs === true,
  });
  useEffect(() => {
    if (
      !(props.api && sourceFromParams && trackedSource) ||
      sameFilesDocumentPanelSource(sourceFromParams, trackedSource)
    ) {
      return;
    }
    props.api.updateParameters({
      ...(props.params ?? {}),
      source: trackedSource,
    });
    props.api.setTitle(trackedDocument?.name ?? trackedSource.kind);
  }, [
    props.api,
    props.params,
    sourceFromParams,
    trackedDocument,
    trackedSource,
  ]);
  useEffect(() => {
    if (!props.api) {
      return;
    }
    const paramsDirty = props.params?.dirty === true;
    if (paramsDirty === trackedUnsaved) {
      return;
    }
    const promoteToPinned = trackedDirty && props.params?.pinned === false;
    props.api.updateParameters({
      ...(props.params ?? {}),
      dirty: trackedUnsaved,
      ...(promoteToPinned ? { pinned: true } : {}),
    });
  }, [props.api, props.params, trackedDirty, trackedUnsaved]);

  useFilesPanelRemoveClose({
    containerApi: (
      props as {
        containerApi?: {
          onDidRemovePanel?: (listener: (panel: { id?: string }) => void) => {
            dispose?: () => void;
          };
        };
      }
    ).containerApi,
    controller,
    panelId: props.api?.id,
    runtimeContext,
    stableSource,
  });

  const handleOpenFileFromTree = useCallback(
    (entry: FileEntry, options?: { pinned?: boolean }) => {
      if (!runtimeContext) {
        return;
      }
      const nextSource: FilesDocumentPanelSource = {
        kind: "disk",
        path: entry.path,
        root: entry.root,
      };
      const nextName = entry.path.split("/").at(-1) ?? entry.path;
      const panelContext = props.params?.context;
      const pinned = options?.pinned === true;
      runtimeContext.panels.openInstance({
        componentId: FILES_FILE_PANEL_ID,
        ...(panelContext ? { context: panelContext } : {}),
        dropUnpinnedInstances: !pinned,
        instanceId: createFileFilePanelInstanceId(nextSource),
        params: {
          pinned,
          source: nextSource,
        },
        title: nextName,
      });
    },
    [props.params?.context, runtimeContext]
  );

  const handleOpenSearch = useCallback(() => {
    setSearchRequest((r) => r + 1);
  }, [setSearchRequest]);

  const treeInstanceId = props.api?.id ?? "pier.files.inlineFilePanel";
  const handleBreadcrumbClick = useCallback(
    (index: number, source: FilesDocumentPanelSource) => {
      if (!(root && runtimeContext) || source.kind !== "disk") {
        return;
      }
      revealDiskBreadcrumbInTree({
        context: runtimeContext,
        index,
        instanceId: treeInstanceId,
        path: source.path,
        projectName,
        root,
        setTreeCollapsed,
        source,
        treeCollapsed,
      });
    },
    [
      projectName,
      root,
      runtimeContext,
      setTreeCollapsed,
      treeCollapsed,
      treeInstanceId,
    ]
  );
  // Shared group view owns chrome + tree + editor; thin shell stays empty.
  if (prefersSharedGroupView) {
    return <div aria-hidden="true" className="h-full w-full" />;
  }

  const activeFilePath = activeFilePathForTree({
    root,
    source: sourceFromParams,
  });
  const { externalActiveFile, outsideWorkspace } = outsideWorkspaceStateFor(
    sourceFromParams,
    root,
    props.params?.context
  );
  const sidebar = renderFilePanelSidebar({
    activeFilePath,
    controller,
    externalActiveFile,
    instanceId: props.api?.id ?? "pier.files.inlineFilePanel",
    onOpenFile: handleOpenFileFromTree,
    root,
    runtimeContext,
    treeCollapsed,
    watchHub: runtimeWatchHub,
  });

  const chromeLeading = (
    <>
      <SidebarToggleButton
        collapsed={treeCollapsed}
        hidden={!root}
        onToggle={() => setTreeCollapsed(!treeCollapsed)}
        t={t}
      />
      <FilePanelSearchButton
        label={t("filePanel.search", "Find in file")}
        onOpenSearch={handleOpenSearch}
        t={t}
      />
    </>
  );

  const shellProps = {
    onSidebarAutoCollapse: () => setTreeCollapsed(true),
    sidebar,
  };
  const breadcrumbContextMenu = filesBreadcrumbContextMenuHandler({
    context: runtimeContext,
    ...(props.params?.context ? { panelContext: props.params.context } : {}),
    ...(props.api?.id ? { panelId: props.api.id } : {}),
    source: sourceFromParams,
    t,
  });
  const diskBreadcrumb = sourceFromParams ? (
    <FilePanelBreadcrumb
      ariaLabel={t("filePanel.breadcrumbLabel", "File location")}
      {...(breadcrumbContextMenu
        ? { onContextMenu: breadcrumbContextMenu }
        : {})}
      {...(outsideWorkspace
        ? {}
        : {
            onSegmentClick: (index: number) =>
              handleBreadcrumbClick(index, sourceFromParams),
          })}
      segments={breadcrumbSegmentsForPanelSource(
        sourceFromParams,
        projectName,
        outsideWorkspace
      )}
    />
  ) : null;

  if (sourceFromParams?.kind === "disk" && outsideWorkspace) {
    return (
      <FilePanelShell
        {...shellProps}
        header={
          <FilePanelChrome center={diskBreadcrumb} leading={chromeLeading} />
        }
      >
        <div className="flex h-full min-h-0 flex-col">
          <OutsideWorkspaceBanner
            context={runtimeContext}
            path={sourceFromParams.path}
            root={sourceFromParams.root}
            t={t}
          />
          <div className="flex min-h-0 flex-1 flex-col">
            <ResolvedFilePanel
              context={runtimeContext}
              controller={controller}
              editorSessionId={editorSessionId}
              markdownAnchor={props.params?.markdownAnchor}
              markdownAnchorRequestId={props.params?.markdownAnchorRequestId}
              markdownRevealLine={props.params?.markdownRevealLine}
              mode={mode}
              onModeChange={setMode}
              panelContext={props.params?.context}
              panelId={props.api?.id}
              searchRequest={searchRequest}
              source={sourceFromParams}
              t={t}
            />
          </div>
        </div>
      </FilePanelShell>
    );
  }

  if (sourceState.kind === "invalid") {
    return (
      <FilePanelShell
        {...shellProps}
        header={
          <FilePanelChrome
            center={
              <span className="truncate font-mono text-muted-foreground text-xs">
                {sourceState.title}
              </span>
            }
            leading={chromeLeading}
          />
        }
      >
        <ReadOnlyErrorState
          message={sourceState.message}
          t={t}
          title={sourceState.title}
        />
      </FilePanelShell>
    );
  }

  if (!sourceFromParams) {
    return (
      <FilePanelShell
        {...shellProps}
        header={
          <FilePanelChrome
            center={
              <span className="truncate font-mono text-muted-foreground text-xs">
                {projectName ?? t("filePanel.title", "File")}
              </span>
            }
            leading={chromeLeading}
          />
        }
      >
        <EmptyFileState hasProjectTree={Boolean(root)} t={t} />
      </FilePanelShell>
    );
  }

  return (
    <FilePanelShell
      {...shellProps}
      header={
        <FilePanelChrome
          center={diskBreadcrumb}
          leading={chromeLeading}
          trailing={
            <ResolvedFilePanelActions
              context={runtimeContext}
              controller={controller}
              editorSessionId={editorSessionId}
              mode={mode}
              onModeChange={setMode}
              panelId={props.api?.id}
              source={sourceFromParams}
              t={t}
            />
          }
        />
      }
    >
      <ResolvedFilePanel
        context={runtimeContext}
        controller={controller}
        editorSessionId={editorSessionId}
        markdownAnchor={props.params?.markdownAnchor}
        markdownAnchorRequestId={props.params?.markdownAnchorRequestId}
        markdownRevealLine={props.params?.markdownRevealLine}
        mode={mode}
        onModeChange={setMode}
        panelContext={props.params?.context}
        panelId={props.api?.id}
        searchRequest={searchRequest}
        source={sourceFromParams}
        t={t}
      />
    </FilePanelShell>
  );
}
export function createFilePanel(
  context: RendererPluginContext,
  controller: FileEditorController,
  watchHub: FilesWatchHub
) {
  return function FilesFilePanel(props: IDockviewPanelProps) {
    return (
      <FilePanelContent
        {...(props as FilePanelRuntimeProps)}
        runtimeContext={context}
        runtimeController={controller}
        runtimeWatchHub={watchHub}
      />
    );
  };
}
