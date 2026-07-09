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
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import { ResolvedFilePanelActions } from "./file-panel-actions.tsx";
import { ResolvedFilePanel } from "./file-panel-body.tsx";
import { useDocumentId } from "./file-panel-hooks.ts";
import { createFileFilePanelInstanceId } from "./file-panel-id.ts";
import {
  EmptyFileState,
  FilePanelBreadcrumb,
  FilePanelChrome,
  FilePanelSearchButton,
  FilePanelShell,
  ReadOnlyErrorState,
  SidebarToggleButton,
} from "./file-panel-parts.tsx";
import {
  asGroupHandle,
  breadcrumbSegmentsForSource,
  parseSourceState,
  sourceTitle,
} from "./file-panel-source.ts";
import type { FilePanelRuntimeProps } from "./file-panel-types.ts";
import {
  filePanelProjectRoot,
  projectNameFromRoot,
  useProjectFileTreeCollapsed,
} from "./file-tree-preferences.ts";
import { FileTreeSidebar } from "./file-tree-sidebar.tsx";
import {
  ensureDiskDocument,
  getDocument,
  removeDocument,
  useFilesDocument,
} from "./files-document-store.ts";
import {
  type FilesDocumentPanelSource,
  type FileViewMode,
  isDiskSourceRootAllowed,
} from "./files-document-types.ts";
import {
  claimFilesGroupView,
  releaseFilesGroupView,
} from "./files-group-view-host.tsx";
import { createFilesTranslate } from "./files-i18n.ts";
import { hasOtherOpenFilesSourceInstance } from "./files-panel-instance-utils.ts";

function FilePanelContent({
  runtimeContext,
  runtimeFiles,
  ...props
}: FilePanelRuntimeProps) {
  const files = runtimeContext?.files ?? runtimeFiles;
  const t = useMemo(
    () => createFilesTranslate(runtimeContext),
    [runtimeContext]
  );
  const sourceState = useMemo(
    () => parseSourceState(props.params, t),
    [props.params, t]
  );
  const sourceFromParams =
    sourceState.kind === "source" ? sourceState.source : null;
  const [mode, setMode] = useState<FileViewMode>("source");
  const [saving, setSaving] = useState(false);
  const [searchRequest, setSearchRequest] = useState(0);
  const root = filePanelProjectRoot(props.params?.context);
  const [treeCollapsed, setTreeCollapsed] = useProjectFileTreeCollapsed(root);
  const projectName = root ? projectNameFromRoot(root) : null;
  // group 绑定必须是「活的」:dockview 拖拽跨组不 remount 组件,只 reparent
  // 内容 DOM。render 期快照会指向旧 group(薄壳空白 + 旧组视图泄漏),
  // 所以经 onDidGroupChange 把 groupId 提升为 state,变化时靠下方 effect 的
  // cleanup/setup 对称性自动完成「旧组注销 → 新组登记」迁移。
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
  const ownerIdRef = useRef<symbol | null>(null);
  if (ownerIdRef.current === null) {
    ownerIdRef.current = Symbol(props.api?.id ?? "inline");
  }
  // group 一旦存在就永远走薄壳,绝不等 claim 成功再切 —— 否则首帧会短暂
  // mount 内联 FileTreeSidebar,用户感知为「目录树跳一下」。
  const prefersSharedGroupView = Boolean(
    runtimeContext && group && props.api?.id && ownerIdRef.current
  );

  // 薄壳唯一的共享视图职责:claim/release(owner 计数)。数据(active/
  // params/source)由 FilesGroupView 直读 dockview,薄壳不再镜像任何状态,
  // 也就不存在陈旧闭包写回的问题。
  useLayoutEffect(() => {
    if (
      !(
        prefersSharedGroupView &&
        group &&
        props.api?.id &&
        ownerIdRef.current &&
        runtimeContext
      )
    ) {
      return;
    }
    const groupId = group.id;
    const ownerId = ownerIdRef.current;
    // claim 可能失败:layout 恢复期 group 容器尚未挂进 DOM。RAF 重试兜底。
    let cancelled = false;
    let retryHandle: number | null = null;
    let attempts = 0;
    const tryClaim = () => {
      if (cancelled) {
        return;
      }
      const claimed = claimFilesGroupView({
        context: runtimeContext,
        group,
        ownerId,
      });
      if (claimed || attempts >= 10) {
        if (!claimed) {
          console.error(
            "[files] group view claim failed after retries:",
            groupId
          );
        }
        return;
      }
      attempts += 1;
      retryHandle = requestAnimationFrame(tryClaim);
    };
    tryClaim();
    return () => {
      cancelled = true;
      if (retryHandle !== null) {
        cancelAnimationFrame(retryHandle);
      }
      releaseFilesGroupView({ context: runtimeContext, groupId, ownerId });
    };
  }, [group, prefersSharedGroupView, props.api?.id, runtimeContext]);

  // tab 未保存圆点:document.dirty 变化时写进 params(与 preview 斜体同通道),
  // panel-tab-header 经 onDidParametersChange 收到后渲染。dirty 同时并入
  // preview→pinned promote(写在同一次 updateParameters,避免两个 effect
  // 各自 spread 旧 params 相互覆盖)。
  const trackedDocumentId = useDocumentId(sourceFromParams);
  const trackedDocument = useFilesDocument(trackedDocumentId ?? "");
  const trackedDirty = trackedDocument?.dirty === true;
  useEffect(() => {
    if (!props.api) {
      return;
    }
    const paramsDirty = props.params?.dirty === true;
    if (paramsDirty === trackedDirty) {
      return;
    }
    const promoteToPinned = trackedDirty && props.params?.pinned === false;
    props.api.updateParameters({
      ...(props.params ?? {}),
      dirty: trackedDirty,
      ...(promoteToPinned ? { pinned: true } : {}),
    });
  }, [props.api, props.params, trackedDirty]);

  // 「真关闭」信号:dockview 的 onDidRemovePanel 只在面板真正被移除时触发;
  // 组件 remount(布局恢复/组件重建)与跨组拖拽都不会。unmount 本身不可靠
  // (remount 也走 unmount),必须以该信号门控会话清理。
  const closedViaRemoveRef = useRef(false);
  useEffect(() => {
    const panelId = props.api?.id;
    const containerApi = (
      props as {
        containerApi?: {
          onDidRemovePanel?: (listener: (panel: { id?: string }) => void) => {
            dispose?: () => void;
          };
        };
      }
    ).containerApi;
    if (!(panelId && containerApi?.onDidRemovePanel)) {
      return;
    }
    const disposable = containerApi.onDidRemovePanel((panel) => {
      if (panel?.id === panelId) {
        closedViaRemoveRef.current = true;
      }
    });
    return () => {
      disposable?.dispose?.();
    };
  }, [props.api?.id, props.containerApi]);

  // 关闭 tab = 结束会话(VS Code 语义):真关闭时丢弃干净的 disk 文档
  // (内容/undo/光标缓存),下次打开从磁盘新读。脏文档不在此清 —— 关闭守卫
  // 的 保存/不保存 分支各自处置;崩溃场景无关闭信号,hot-exit 草稿仍生效。
  const diskDocumentId =
    sourceFromParams?.kind === "disk" ? trackedDocumentId : null;
  useEffect(() => {
    if (!(diskDocumentId && sourceFromParams?.kind === "disk")) {
      return;
    }
    const source = sourceFromParams;
    const panelId = props.api?.id;
    return () => {
      if (!closedViaRemoveRef.current) {
        return;
      }
      if (
        hasOtherOpenFilesSourceInstance({
          context: runtimeContext,
          panelId,
          source,
        })
      ) {
        return;
      }
      const latest = getDocument(diskDocumentId);
      if (latest && !latest.dirty) {
        removeDocument(diskDocumentId);
      }
    };
  }, [diskDocumentId, props.api?.id, runtimeContext, sourceFromParams]);

  // untitled 文档生命周期跟随 panel 真关闭,不跟随共享视图的 body 或组件
  // remount:body 卸载/重建时删文档会丢 undo 历史,只能靠草稿部分恢复。
  const untitledSourceId =
    sourceFromParams?.kind === "untitled" ? sourceFromParams.id : null;
  useEffect(() => {
    if (!(untitledSourceId && prefersSharedGroupView)) {
      return;
    }
    return () => {
      if (closedViaRemoveRef.current) {
        removeDocument(untitledSourceId);
      }
    };
  }, [prefersSharedGroupView, untitledSourceId]);

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
      ensureDiskDocument({
        name: nextName,
        path: entry.path,
        root: entry.root,
      });
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
  }, []);

  // 共享 group 视图已接管 chrome+树+编辑器;薄壳仅占位保持 dockview tab 生命周期。
  if (prefersSharedGroupView) {
    return <div aria-hidden="true" className="h-full w-full" />;
  }

  const sidebar =
    runtimeContext && root && !treeCollapsed ? (
      <FileTreeSidebar
        context={runtimeContext}
        instanceId={props.api?.id ?? "pier.files.inlineFilePanel"}
        onOpenFile={handleOpenFileFromTree}
        root={root}
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
        label={t("filePanel.search", "Find in file")}
        onOpenSearch={handleOpenSearch}
        t={t}
      />
    </>
  );

  const selectedSource = sourceFromParams;
  const outsideWorkspace =
    selectedSource?.kind === "disk" &&
    !isDiskSourceRootAllowed(selectedSource.root, props.params?.context);

  if (outsideWorkspace && selectedSource) {
    return (
      <FilePanelShell
        header={
          <FilePanelChrome
            center={
              <FilePanelBreadcrumb
                segments={breadcrumbSegmentsForSource(
                  selectedSource,
                  projectName
                )}
              />
            }
            leading={chromeLeading}
          />
        }
        sidebar={sidebar}
      >
        <ReadOnlyErrorState
          message={t(
            "filePanel.errors.outsideWorkspace",
            "This file source is outside the restored workspace context."
          )}
          t={t}
          title={sourceTitle(selectedSource)}
        />
      </FilePanelShell>
    );
  }

  if (sourceState.kind === "invalid") {
    return (
      <FilePanelShell
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
        sidebar={sidebar}
      >
        <ReadOnlyErrorState
          message={sourceState.message}
          t={t}
          title={sourceState.title}
        />
      </FilePanelShell>
    );
  }

  if (!selectedSource) {
    return (
      <FilePanelShell
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
        sidebar={sidebar}
      >
        <EmptyFileState hasProjectTree={Boolean(root)} t={t} />
      </FilePanelShell>
    );
  }

  return (
    <FilePanelShell
      header={
        <FilePanelChrome
          center={
            <FilePanelBreadcrumb
              segments={breadcrumbSegmentsForSource(
                selectedSource,
                projectName
              )}
            />
          }
          leading={chromeLeading}
          trailing={
            <ResolvedFilePanelActions
              {...(runtimeContext
                ? {
                    configuration: runtimeContext.configuration,
                    resolveConflict: async () => {
                      const choice = await runtimeContext.dialogs.choice({
                        altLabel: t(
                          "filePanel.conflict.compareLabel",
                          "Compare"
                        ),
                        body: t(
                          "filePanel.conflict.body",
                          "The file has been modified outside Pier. Overwrite it anyway?"
                        ),
                        cancelLabel: t(
                          "filePanel.conflict.cancelLabel",
                          "Cancel"
                        ),
                        confirmLabel: t(
                          "filePanel.conflict.confirmLabel",
                          "Overwrite"
                        ),
                        intent: "destructive" as const,
                        size: "sm" as const,
                        title: t(
                          "filePanel.conflict.title",
                          "File changed on disk"
                        ),
                      });
                      if (choice === "confirm") {
                        return "overwrite" as const;
                      }
                      if (choice === "alt") {
                        return "compare" as const;
                      }
                      return "cancel" as const;
                    },
                  }
                : {})}
              files={files}
              mode={mode}
              onModeChange={setMode}
              onSavingChange={setSaving}
              panelId={props.api?.id}
              saving={saving}
              source={selectedSource}
              t={t}
            />
          }
        />
      }
      sidebar={sidebar}
    >
      <ResolvedFilePanel
        context={runtimeContext}
        files={files}
        manageUntitledLifecycle
        mode={mode}
        panelApi={props.api}
        panelContext={props.params?.context}
        panelId={props.api?.id}
        panelParams={props.params as Record<string, unknown> | undefined}
        searchRequest={searchRequest}
        source={selectedSource}
        t={t}
      />
    </FilePanelShell>
  );
}

export function createFilePanel(context: RendererPluginContext) {
  return function FilesFilePanel(props: IDockviewPanelProps) {
    return (
      <FilePanelContent
        {...(props as FilePanelRuntimeProps)}
        runtimeContext={context}
      />
    );
  };
}
