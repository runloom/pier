import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { useCallback, useRef } from "react";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import { FileEditorAdapter } from "./file-editor-adapter.tsx";
import {
  type FilePanelFilesApi,
  useDiskDocumentLoader,
  useDocumentId,
  usePromoteOnDirty,
  useRemoveUntitledOnUnmount,
  useRestoreUntitledDocument,
} from "./file-panel-hooks.ts";
import {
  MissingTemporaryState,
  ReadOnlyErrorState,
} from "./file-panel-parts.tsx";
import {
  updateDocumentContents,
  useFilesDocument,
} from "./files-document-store.ts";
import type {
  EditorRange,
  FilesDocumentPanelSource,
  FileViewMode,
} from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";

let nextInlineEditorOwnerId = 1;

function createEditorSessionId(ownerId: string, documentId: string): string {
  return JSON.stringify([ownerId, documentId]);
}

export function ResolvedFilePanel({
  context,
  files,
  manageUntitledLifecycle,
  mode,
  panelApi,
  panelContext,
  panelId,
  panelParams,
  searchRequest,
  source,
  t,
}: {
  context: RendererPluginContext | undefined;
  files: FilePanelFilesApi | undefined;
  /**
   * body 卸载是否等于 panel 关闭。内联回退 true;共享 group 视图 false
   * (切 tab 卸载 body 但 panel 仍在,untitled 文档由薄壳按 panel 生命周期清理)。
   */
  manageUntitledLifecycle: boolean;
  mode: FileViewMode;
  panelApi:
    | { updateParameters: (params: Record<string, unknown>) => void }
    | undefined;
  panelContext: PanelContext | undefined;
  panelId: string | undefined;
  panelParams: Record<string, unknown> | undefined;
  searchRequest: number;
  source: FilesDocumentPanelSource;
  t: FilesTranslate;
}) {
  const documentId = useDocumentId(source);
  useRestoreUntitledDocument(source);
  const document = useFilesDocument(documentId ?? "");
  const inlineEditorOwnerIdRef = useRef<string | null>(null);
  if (inlineEditorOwnerIdRef.current === null) {
    inlineEditorOwnerIdRef.current = `inline:${nextInlineEditorOwnerId}`;
    nextInlineEditorOwnerId += 1;
  }
  const editorOwnerId = panelId ?? inlineEditorOwnerIdRef.current;
  const editorSessionId = document
    ? createEditorSessionId(editorOwnerId, document.id)
    : "";

  useDiskDocumentLoader(document, files, t);
  useRemoveUntitledOnUnmount(
    manageUntitledLifecycle ? source : null,
    manageUntitledLifecycle ? document : null
  );
  usePromoteOnDirty(document, panelApi, panelParams);

  const handleChange = useCallback(
    (contents: string) => {
      if (!document || document.readOnly) {
        return;
      }
      updateDocumentContents(document.id, contents);
    },
    [document]
  );

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
          console.error("[files] editor context menu failed:", err);
        });
    },
    [context, document, editorSessionId, panelContext]
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

  // filePath 让 CodeMirror 语言解析能区分 tsx/jsx / .c 与 .cpp。untitled 文档没
  // 有物理路径,直接不传。
  const filePath =
    document.source.kind === "disk" ? document.source.path : undefined;

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
          language={document.language}
          mode={mode}
          onChange={handleChange}
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
          {...(filePath ? { filePath } : {})}
        />
      </main>
    </div>
  );
}
