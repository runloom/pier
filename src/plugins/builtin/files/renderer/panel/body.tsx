import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import type {
  EditorRange,
  FilesDocumentPanelSource,
  FileViewMode,
} from "../document/types.ts";
import { useFilesDocument } from "../document/use-document.ts";
import { FileEditorAdapter } from "../editor/adapter.tsx";
import type { FileEditorController } from "../editor/controller.ts";
import type { FilesTranslate } from "../i18n.ts";
import {
  defaultMarkdownCrossModeAnchor,
  type MarkdownCrossModeAnchor,
  sourceOffsetForLine,
} from "../markdown/cross-mode-anchor.ts";
import { FileImagePreview } from "../preview/image.tsx";
import { FilesFindUnavailableNotice } from "../search/use-find-unavailable.ts";
import { isCanvasDiskDoc } from "./canvas-doc.ts";
import { FileDiskConflictState } from "./disk-conflict-banner.tsx";
import {
  createFileEditorAdapterLabels,
  createFileSearchLabels,
  createMarkdownCommentLabels,
  createMarkdownErrorLabel,
  createMarkdownRendererLabels,
  createMarkdownTocLabels,
  createMarkdownZoomLabels,
} from "./markdown-labels.ts";
import {
  FileReadErrorEmpty,
  FileSaveErrorBanner,
  MissingTemporaryState,
  ReadOnlyErrorState,
} from "./parts.tsx";
import { UnsupportedFilePanel } from "./unsupported-state.tsx";
import { useDiskConflictActions } from "./use-disk-conflict-actions.ts";
import { useFilePanelMarkdownChrome } from "./use-markdown-chrome.ts";

export function ResolvedFilePanel({
  context,
  markdownAnchor,
  markdownAnchorRequestId,
  markdownRevealLine,
  controller,
  editorSessionId,
  mode,
  onModeChange,
  panelContext,
  panelId,
  searchRequest,
  source,
  t,
}: {
  context: RendererPluginContext | undefined;
  markdownAnchor?: string | undefined;
  markdownAnchorRequestId?: string | undefined;
  /** 1-based line when comment jump has no headingId. */
  markdownRevealLine?: number | undefined;
  controller: FileEditorController;
  editorSessionId: string;
  mode: FileViewMode;
  onModeChange?: ((mode: FileViewMode) => void) | undefined;
  panelContext: PanelContext | undefined;
  panelId: string | undefined;
  searchRequest: number;
  source: FilesDocumentPanelSource;
  t: FilesTranslate;
}) {
  const documentId = controller.documentId(source);
  const document = useFilesDocument(documentId);
  const previewCaptureRef = useRef<
    (() => MarkdownCrossModeAnchor | null) | null
  >(null);
  const [previewRestoreAnchor, setPreviewRestoreAnchor] = useState<
    MarkdownCrossModeAnchor | undefined
  >(undefined);
  const [previewRestoreRequestId, setPreviewRestoreRequestId] = useState(0);
  const {
    handleCopyMarkdownAnchor,
    handleCopyMarkdownCode,
    handleMarkdownPreviewContextMenu,
    handleOpenExternal,
    handleOpenMarkdownInternal,
  } = useFilePanelMarkdownChrome({
    context,
    document: document ?? undefined,
    editorSessionId,
    panelContext,
    panelId,
    t,
  });

  // Drop one-shot preview restore when the document identity changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: documentId is the identity trigger; body only clears state.
  useEffect(() => {
    setPreviewRestoreAnchor(undefined);
  }, [documentId]);

  // Comment jump without headingId: map startLine → content offset for preview scroll.
  const lineRevealAnchor = useMemo((): MarkdownCrossModeAnchor | undefined => {
    if (
      markdownRevealLine === undefined ||
      markdownRevealLine < 1 ||
      !document ||
      document.language !== "markdown"
    ) {
      return;
    }
    return defaultMarkdownCrossModeAnchor(
      sourceOffsetForLine(document.currentContents, markdownRevealLine)
    );
  }, [document, markdownRevealLine]);

  const previewContentAnchor = previewRestoreAnchor ?? lineRevealAnchor;
  let previewContentAnchorRequestId: string | number | undefined;
  if (previewRestoreAnchor) {
    previewContentAnchorRequestId = previewRestoreRequestId;
  } else if (markdownRevealLine !== undefined) {
    previewContentAnchorRequestId = markdownAnchorRequestId;
  }

  const handleModeChange = useCallback(
    (next: FileViewMode) => {
      if (!onModeChange) {
        return;
      }
      if (document?.language !== "markdown") {
        setPreviewRestoreAnchor(undefined);
        onModeChange(next);
        return;
      }
      if (mode === "preview" && next === "source") {
        const anchor =
          previewCaptureRef.current?.() ?? defaultMarkdownCrossModeAnchor(0);
        onModeChange("source");
        controller.revealOffset(editorSessionId, anchor.offset, document.id);
        return;
      }
      if (mode === "source" && next === "preview") {
        const anchor =
          controller.captureViewportAnchor(editorSessionId) ??
          defaultMarkdownCrossModeAnchor(0);
        setPreviewRestoreAnchor(anchor);
        setPreviewRestoreRequestId((current) => current + 1);
        onModeChange("preview");
        return;
      }
      setPreviewRestoreAnchor(undefined);
      onModeChange(next);
    },
    [
      controller,
      document?.id,
      document?.language,
      editorSessionId,
      mode,
      onModeChange,
    ]
  );

  // Single mode handler for Eye/Code, diff toggle, and showSourceMode.
  useEffect(() => {
    if (!(panelId && onModeChange)) {
      return;
    }
    return controller.registerPanelModeHandler(panelId, handleModeChange);
  }, [controller, handleModeChange, onModeChange, panelId]);

  // Git 变更条：仅 source + disk 模式渲染。非源码模式清空；切回 source 时刷新。
  // attach 在 controller.attachView 时已发生，故此 effect 仅做清空/刷新。
  useEffect(() => {
    if (!editorSessionId) {
      return;
    }
    if (mode !== "source") {
      controller.clearGitGutter(editorSessionId);
      return;
    }
    if (document?.source.kind === "disk") {
      controller.refreshGitGutterByDocument(document.id);
    } else {
      controller.clearGitGutter(editorSessionId);
    }
  }, [controller, document?.id, document?.source.kind, editorSessionId, mode]);

  // 编辑器右键 → 走宿主 contextMenu.popup, source 塞进 metadata。source 层
  // (files/editor) 与 tree (files/tree-item) 分开,权限声明和菜单顺序也各自
  // 独立,不会互相污染。
  const handleEditorContextMenu = useCallback(
    (event: MouseEvent, ranges: readonly EditorRange[]) => {
      if (!(document && context && editorSessionId)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const firstRange = ranges.at(0);
      context.contextMenu
        .popup(
          "files/editor",
          { x: event.clientX, y: event.clientY },
          {
            metadata: {
              documentId: document.id,
              editorSessionId,
              ranges,
              source: document.source,
              // 扁平字段供 copyPathWithRange 等 action 的 zod schema 直接解析。
              ...(document.source.kind === "disk"
                ? {
                    path: document.source.path,
                    root: document.source.root,
                    ...(panelContext?.projectRootPath
                      ? { projectRoot: panelContext.projectRootPath }
                      : {}),
                  }
                : {}),
              ...(firstRange
                ? {
                    selectionEndLine: firstRange.endLine,
                    selectionStartLine: firstRange.startLine,
                  }
                : {}),
            },
            sourcePanelComponent: FILES_FILE_PANEL_ID,
            ...(panelContext ? { sourcePanelContext: panelContext } : {}),
            ...(panelId ? { sourcePanelId: panelId } : {}),
          }
        )
        .catch((err: unknown) => {
          context.dialogs
            .alert({
              body: err instanceof Error ? err.message : String(err),
              title: t(
                "filePanel.editor.contextMenuFailed",
                "Unable to open editor menu"
              ),
            })
            .catch(() => undefined);
        });
    },
    [context, document, editorSessionId, panelContext, panelId, t]
  );

  const handleReveal = useCallback(async () => {
    if (!(context && document?.source.kind === "disk")) {
      return;
    }
    try {
      const result = await context.files.reveal({
        path: document.source.path,
        root: document.source.root,
      });
      if (!result.revealed) {
        throw new Error(
          t(
            "filePanel.unsupported.revealUnavailable",
            "The system file manager did not reveal the file."
          )
        );
      }
    } catch (error) {
      await context.dialogs
        .alert({
          body: error instanceof Error ? error.message : String(error),
          title: t(
            "filePanel.unsupported.revealFailed",
            "Unable to show file in file manager"
          ),
        })
        .catch(() => undefined);
    }
  }, [context, document, t]);

  const {
    handleCompareDiskConflict,
    handleDismissDiskConflict,
    handleLoadDiskVersion,
  } = useDiskConflictActions({
    controller,
    dialogs: context?.dialogs,
    document: document ?? null,
    mode,
    onModeChange,
    panelId,
    t,
  });

  if (!document) {
    if (source.kind === "untitled") {
      return <MissingTemporaryState name={source.name} t={t} />;
    }
    return (
      <ReadOnlyErrorState
        message={t(
          "filePanel.errors.diskDocumentMissing",
          "This saved file could not be restored."
        )}
        t={t}
        title={source.path.split("/").filter(Boolean).at(-1) ?? source.path}
      />
    );
  }

  if (document.preview && context) {
    return (
      <FilesFindUnavailableNotice
        context={context}
        panelId={panelId}
        searchRequest={searchRequest}
        t={t}
      >
        <FileImagePreview context={context} document={document} t={t} />
      </FilesFindUnavailableNotice>
    );
  }

  // Full-panel Empty decision state (not a top banner). Diff mode keeps the
  // editor so Compare can render; compact chrome stays available there.
  if (
    document.diskConflict &&
    document.source.kind === "disk" &&
    mode !== "diff"
  ) {
    return (
      <FileDiskConflictState
        canCompare={document.conflictDiskContents !== null}
        document={document}
        onCompare={handleCompareDiskConflict}
        onDismiss={handleDismissDiskConflict}
        onLoadDisk={handleLoadDiskVersion}
        t={t}
      />
    );
  }

  if (document.readOnlyReason) {
    return (
      <UnsupportedFilePanel
        context={context}
        controller={controller}
        document={document}
        onReveal={handleReveal}
        t={t}
      />
    );
  }

  // Read failed: full Empty. Save failed: soft banner with body still visible.
  if (document.loadState === "error") {
    return (
      <FileReadErrorEmpty
        {...(context ? { context } : {})}
        folderAccessBlocked={document.folderAccessBlocked === true}
        message={document.error}
        onReload={
          document.source.kind === "disk"
            ? () => {
                controller
                  .reloadDocumentFromDisk(document.id)
                  .catch(() => undefined);
              }
            : undefined
        }
        t={t}
        title={document.name}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* 保留 sr-only h1:测试用 role="heading" 拿文件名,同时无障碍读屏能定位当前文档标题。 */}
      <h1 className="sr-only">{document.name}</h1>

      {document.error ? (
        <FileSaveErrorBanner message={document.error} t={t} />
      ) : null}
      {document.diskConflict && document.source.kind === "disk" ? (
        <FileDiskConflictState
          canCompare={document.conflictDiskContents !== null}
          document={document}
          onCompare={handleCompareDiskConflict}
          onDismiss={handleDismissDiskConflict}
          onLoadDisk={handleLoadDiskVersion}
          t={t}
          variant="diff-chrome"
        />
      ) : null}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <FileEditorAdapter
          canvasDiskSource={
            document.source.kind === "disk" && isCanvasDiskDoc(document)
              ? { path: document.source.path, root: document.source.root }
              : undefined
          }
          context={context}
          controller={controller}
          documentId={document.id}
          editorSessionId={editorSessionId}
          htmlDiskSource={
            document.source.kind === "disk" && document.language === "html"
              ? { path: document.source.path, root: document.source.root }
              : undefined
          }
          labels={createFileEditorAdapterLabels(t)}
          language={isCanvasDiskDoc(document) ? "canvas" : document.language}
          markdownAppearance={context?.appearance}
          markdownCaptureAnchorRef={previewCaptureRef}
          markdownCharts={context?.charts}
          markdownCommentLabels={createMarkdownCommentLabels(t)}
          markdownContentAnchor={previewContentAnchor}
          markdownContentAnchorRequestId={previewContentAnchorRequestId}
          markdownCopyAnchor={context ? handleCopyMarkdownAnchor : undefined}
          markdownCopyCode={context ? handleCopyMarkdownCode : undefined}
          markdownErrorLabel={createMarkdownErrorLabel(t)}
          markdownFileResources={context}
          markdownInitialAnchor={markdownAnchor}
          markdownInitialAnchorRequestId={markdownAnchorRequestId}
          markdownLabels={createMarkdownRendererLabels(t)}
          markdownSource={
            document.source.kind === "disk" ? document.source : undefined
          }
          markdownTocLabels={createMarkdownTocLabels(t)}
          markdownZoomLabels={createMarkdownZoomLabels(t)}
          mode={mode}
          onEditorContextMenu={handleEditorContextMenu}
          onJumpToSource={
            onModeChange
              ? (offset) => {
                  // Bypass viewport capture: ⌥+double-click / context-menu
                  // jump targets this block's start.
                  onModeChange("source");
                  controller.revealOffset(editorSessionId, offset, document.id);
                }
              : undefined
          }
          onMarkdownPreviewContextMenu={handleMarkdownPreviewContextMenu}
          onOpenMarkdownInternal={handleOpenMarkdownInternal}
          openExternal={handleOpenExternal}
          panelContext={panelContext}
          panelId={panelId}
          readOnly={document.readOnly || document.loadState === "loading"}
          registerSelectionSelectAllProvider={
            context?.contextMenu?.registerSelectionSelectAllProvider
          }
          searchLabels={createFileSearchLabels(t)}
          searchRequest={searchRequest}
          t={t}
          value={document.currentContents}
          {...(mode === "diff"
            ? {
                originalValue:
                  document.conflictDiskContents ?? document.savedContents,
              }
            : {})}
        />
      </main>
    </div>
  );
}
