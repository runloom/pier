import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import { formatBytes } from "@pier/ui/format.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { FolderSearch } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import { FileEditorAdapter } from "./file-editor-adapter.tsx";
import type { FileEditorController } from "./file-editor-controller.ts";
import { FileImagePreview } from "./file-image-preview.tsx";
import {
  createFileEditorAdapterLabels,
  createFileSearchLabels,
  createMarkdownErrorLabel,
  createMarkdownRendererLabels,
  createMarkdownTocLabels,
  createMarkdownZoomLabels,
} from "./file-panel-markdown-labels.ts";
import {
  MissingTemporaryState,
  ReadOnlyErrorState,
  UnsupportedFileState,
} from "./file-panel-parts.tsx";
import type {
  EditorRange,
  FilesDocumentPanelSource,
  FileViewMode,
} from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";
import { useFilePanelMarkdownChrome } from "./use-file-panel-markdown-chrome.ts";
import { useFilesDocument } from "./use-files-document.ts";

let nextInlineEditorOwnerId = 1;

function createEditorSessionId(ownerId: string): string {
  return JSON.stringify([ownerId]);
}

export function ResolvedFilePanel({
  context,
  markdownAnchor,
  markdownAnchorRequestId,
  controller,
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
  controller: FileEditorController;
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
  const inlineEditorOwnerIdRef = useRef<string | null>(null);
  if (inlineEditorOwnerIdRef.current === null) {
    inlineEditorOwnerIdRef.current = `inline:${nextInlineEditorOwnerId}`;
    nextInlineEditorOwnerId += 1;
  }
  const editorOwnerId = panelId ?? inlineEditorOwnerIdRef.current;
  const editorSessionId = document ? createEditorSessionId(editorOwnerId) : "";
  const {
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
    return <FileImagePreview context={context} document={document} t={t} />;
  }

  if (document.readOnlyReason) {
    let actions: ReactNode;
    if (
      document.readOnlyReason === "binary" &&
      context &&
      document.source.kind === "disk"
    ) {
      actions = (
        <Button
          onClick={handleReveal}
          size="sm"
          type="button"
          variant="default"
        >
          <FolderSearch data-icon="inline-start" />
          {t("filePanel.unsupported.reveal", "Show in file manager")}
        </Button>
      );
    } else if (document.readOnlyReason === "mixed-eol") {
      actions = (
        <>
          <Button
            onClick={() => controller.normalizeDocumentEol(document.id, "lf")}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("filePanel.unsupported.normalizeLf", "Normalize to LF")}
          </Button>
          <Button
            onClick={() => controller.normalizeDocumentEol(document.id, "crlf")}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("filePanel.unsupported.normalizeCrlf", "Normalize to CRLF")}
          </Button>
        </>
      );
    }
    let details: ReactNode;
    if (document.readOnlyReason === "binary") {
      const type =
        document.mime ?? t("filePanel.unsupported.binaryType", "Binary");
      const size =
        document.size === null
          ? null
          : formatBytes(document.size, context?.i18n.language() ?? "en");
      details = (
        <p className="font-mono text-muted-foreground text-xs tabular-nums">
          {size ? `${type} · ${size}` : type}
        </p>
      );
    }
    const messageByReason = {
      binary: t(
        "filePanel.unsupported.binary",
        "Binary files are not opened in the text editor."
      ),
      "mixed-eol": t(
        "filePanel.unsupported.mixedEol",
        "Files with mixed line endings are read-only to avoid changing their bytes unexpectedly."
      ),
      "not-writable": t(
        "filePanel.unsupported.notWritable",
        "Pier does not have permission to write this file."
      ),
      "too-large": t(
        "filePanel.unsupported.tooLarge",
        "This file is too large to open in the editor."
      ),
      "unknown-encoding": t(
        "filePanel.unsupported.unknownEncoding",
        "This text encoding is not supported."
      ),
      "unsupported-file": t(
        "filePanel.unsupported.fileType",
        "This file type is not supported by the editor."
      ),
    } satisfies Record<NonNullable<typeof document.readOnlyReason>, string>;
    return (
      <UnsupportedFileState
        actions={actions}
        details={details}
        message={messageByReason[document.readOnlyReason]}
        title={document.name}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* 保留 sr-only h1:测试用 role="heading" 拿文件名,同时无障碍读屏能定位当前文档标题。 */}
      <h1 className="sr-only">{document.name}</h1>

      {document.error ? (
        <div className="shrink-0 px-4 py-3">
          <Alert variant="destructive">
            <AlertTitle>
              {document.loadState === "error"
                ? t("filePanel.errors.read.title", "Unable to read file")
                : t("filePanel.errors.save.title", "Unable to save file")}
            </AlertTitle>
            <AlertDescription>{document.error}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <FileEditorAdapter
          controller={controller}
          documentId={document.id}
          editorSessionId={editorSessionId}
          labels={createFileEditorAdapterLabels(t)}
          markdownAppearance={context?.appearance}
          markdownCharts={context?.charts}
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
                  onModeChange("source");
                  controller.revealOffset(editorSessionId, offset);
                }
              : undefined
          }
          onMarkdownPreviewContextMenu={handleMarkdownPreviewContextMenu}
          onOpenMarkdownInternal={handleOpenMarkdownInternal}
          openExternal={handleOpenExternal}
          panelId={panelId}
          readOnly={document.readOnly || document.loadState === "loading"}
          registerSelectionSelectAllProvider={
            context?.contextMenu.registerSelectionSelectAllProvider
          }
          searchLabels={createFileSearchLabels(t)}
          searchRequest={searchRequest}
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
