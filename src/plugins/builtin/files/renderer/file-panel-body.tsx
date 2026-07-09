import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { useCallback, useRef } from "react";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import { FileEditorAdapter } from "./file-editor-adapter.tsx";
import type { FileEditorController } from "./file-editor-controller.ts";
import {
  MissingTemporaryState,
  ReadOnlyErrorState,
} from "./file-panel-parts.tsx";
import type {
  EditorRange,
  FilesDocumentPanelSource,
  FileViewMode,
} from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";
import { useFilesDocument } from "./use-files-document.ts";

let nextInlineEditorOwnerId = 1;

function createEditorSessionId(ownerId: string): string {
  return JSON.stringify([ownerId]);
}

export function ResolvedFilePanel({
  context,
  controller,
  mode,
  panelContext,
  panelId,
  searchRequest,
  source,
  t,
}: {
  context: RendererPluginContext | undefined;
  controller: FileEditorController;
  mode: FileViewMode;
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
    [context, document, editorSessionId, panelContext, t]
  );

  if (!document) {
    if (source.kind === "untitled") {
      return <MissingTemporaryState name={source.name} t={t} />;
    }
    return (
      <ReadOnlyErrorState
        message={t(
          "filePanel.errors.diskDocumentMissing",
          "This disk file document could not be restored."
        )}
        t={t}
        title={source.path.split("/").filter(Boolean).at(-1) ?? source.path}
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
          labels={{
            diffUnsupported: t(
              "filePanel.view.diffUnsupported",
              "Diff view is not enabled yet."
            ),
            richUnsupported: t(
              "filePanel.view.richUnsupported",
              "Rich Markdown editing is not enabled yet."
            ),
            sourceEditor: t("filePanel.editor.sourceLabel", "Source editor"),
          }}
          mode={mode}
          onEditorContextMenu={handleEditorContextMenu}
          readOnly={document.readOnly || document.loadState === "loading"}
          searchLabels={{
            close: t("filePanel.search.close", "Close"),
            matchCase: t("filePanel.search.matchCase", "Match case"),
            next: t("filePanel.search.next", "Next match"),
            noMatches: t("filePanel.search.noMatches", "No matches"),
            placeholder: t("filePanel.search.placeholder", "Find"),
            previous: t("filePanel.search.previous", "Previous match"),
            regexp: t("filePanel.search.regexp", "Regexp"),
            replace: t("filePanel.search.replace", "Replace"),
            replaceAll: t("filePanel.search.replaceAll", "Replace all"),
            replacePlaceholder: t(
              "filePanel.search.replacePlaceholder",
              "Replace"
            ),
            selectAll: t("filePanel.search.selectAll", "Select all matches"),
            wholeWord: t("filePanel.search.wholeWord", "Whole word"),
          }}
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
