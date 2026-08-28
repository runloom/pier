import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@pier/ui/empty.tsx";
import { Construction } from "lucide-react";
import { useMemo } from "react";
import { FILES_EDITOR_WORD_WRAP_SETTING_KEY } from "../../settings.ts";
import { getDocument, updateDocumentContents } from "../document/store.ts";
import { useFilesDocument } from "../document/use-document.ts";
import { FilesLineDiff } from "../markdown/line-diff.tsx";
import { MarkdownPreview } from "../markdown/preview.tsx";
import {
  patchTaskMarker,
  type TaskToggleInput,
} from "../markdown/task-patch.ts";
import { FileCanvasPreview } from "../preview/canvas.tsx";
import { FileHtmlPreview } from "../preview/html.tsx";
import { FileImagePreview } from "../preview/image.tsx";
import { FilesFindUnavailableNotice } from "../search/use-find-unavailable.ts";
import type { FileEditorAdapterProps } from "./adapter-types.ts";
import { CodeMirrorEditor } from "./cm.tsx";

const DEFAULT_LABELS = {
  diffUnsupported: "No disk contents available to compare.",
  sourceEditor: "Source editor",
};

export function FileEditorAdapter(props: FileEditorAdapterProps) {
  const labels = props.labels ?? DEFAULT_LABELS;
  const context = props.context;
  const onToggleWordWrap = context
    ? () => {
        context.configuration
          .set(
            FILES_EDITOR_WORD_WRAP_SETTING_KEY,
            context.configuration.get<boolean>(
              FILES_EDITOR_WORD_WRAP_SETTING_KEY
            ) !== true
          )
          .catch((error: unknown) => {
            // 配置写入失败必须可见（仓库反馈规范：异步变更不许静默）。
            context.notifications.error(
              error instanceof Error ? error.message : String(error)
            );
          });
      }
    : undefined;
  // Task-checkbox write-back: the preview is the only Markdown content edit
  // channel. Flip the marker in the current buffer and hand the patched
  // contents to the document model — dirty/autosave/CAS conflict handling is
  // inherited from updateDocumentContents. Disabled under diskConflict freeze
  // and readOnly (mirrors saver-side guards).
  const document = useFilesDocument(props.documentId);
  const svgPreviewDocument = useMemo(() => {
    if (!(document && document.source.kind === "disk" && document.revision)) {
      return null;
    }
    return {
      ...document,
      preview: {
        kind: "image" as const,
        mime: "image/svg+xml" as const,
        revision: document.revision,
      },
    };
  }, [document]);
  const onToggleTask =
    document && !document.diskConflict && !document.readOnly
      ? ({ rangeStart, rangeEnd, checked }: TaskToggleInput) => {
          // Handler 内重读最新 store 状态：基于 render 快照做 read-modify-write
          // 会覆盖快照之后落库的并发写入（其他面板键入 / 异步 watch 重读），
          // 且 loadState 未 loaded 时预览渲染的是旧内容，写入会丢盘上新内容。
          const latest = getDocument(document.id);
          if (
            !latest ||
            latest.diskConflict ||
            latest.readOnly ||
            latest.loadState !== "loaded"
          ) {
            return;
          }
          const next = patchTaskMarker(
            latest.currentContents,
            { end: rangeEnd, start: rangeStart },
            checked
          );
          if (next !== latest.currentContents) {
            updateDocumentContents(latest.id, next);
          }
        }
      : undefined;

  if (props.mode === "preview") {
    // Canvas must never fall through to MarkdownPreview (raw TSX as markdown).
    if (props.language === "canvas" || props.canvasDiskSource) {
      if (props.context && props.canvasDiskSource && props.t) {
        return (
          <FilesFindUnavailableNotice
            context={props.context}
            panelId={props.panelId}
            searchRequest={props.searchRequest}
            t={props.t}
          >
            <FileCanvasPreview
              context={props.context}
              panelContext={props.panelContext}
              panelId={props.panelId}
              path={props.canvasDiskSource.path}
              root={props.canvasDiskSource.root}
              t={props.t}
              worktreeKey={
                props.panelContext?.worktreeKey ??
                props.panelContext?.worktreeRoot ??
                props.panelContext?.gitRoot ??
                props.canvasDiskSource.root
              }
            />
          </FilesFindUnavailableNotice>
        );
      }
      return (
        <FilesFindUnavailableNotice
          context={props.context}
          panelId={props.panelId}
          searchRequest={props.searchRequest}
          t={props.t}
        >
          <UnsupportedFileView
            label={
              props.t?.(
                "filePanel.canvas.unavailableTitle",
                "Can’t preview canvas"
              ) ?? "Can’t preview canvas"
            }
          />
        </FilesFindUnavailableNotice>
      );
    }
    if (props.language === "html") {
      if (props.context && props.htmlDiskSource && props.t) {
        return (
          <FilesFindUnavailableNotice
            context={props.context}
            panelId={props.panelId}
            searchRequest={props.searchRequest}
            t={props.t}
          >
            <FileHtmlPreview
              context={props.context}
              documentId={props.documentId}
              path={props.htmlDiskSource.path}
              root={props.htmlDiskSource.root}
              t={props.t}
            />
          </FilesFindUnavailableNotice>
        );
      }
      return <CodeMirrorEditor {...props} />;
    }
    if (props.language === "svg") {
      if (props.context && props.t && svgPreviewDocument) {
        return (
          <FilesFindUnavailableNotice
            context={props.context}
            panelId={props.panelId}
            searchRequest={props.searchRequest}
            t={props.t}
          >
            <FileImagePreview
              context={props.context}
              document={svgPreviewDocument}
              t={props.t}
            />
          </FilesFindUnavailableNotice>
        );
      }
      return <CodeMirrorEditor {...props} />;
    }
    return (
      <MarkdownPreview
        appearance={props.markdownAppearance}
        captureAnchorRef={props.markdownCaptureAnchorRef}
        charts={props.markdownCharts}
        commentLabels={props.markdownCommentLabels}
        commentsContext={props.context}
        contentAnchor={props.markdownContentAnchor}
        contentAnchorRequestId={props.markdownContentAnchorRequestId}
        copyAnchor={props.markdownCopyAnchor}
        copyCode={props.markdownCopyCode}
        errorLabel={props.markdownErrorLabel}
        fileResources={props.markdownFileResources}
        initialAnchor={props.markdownInitialAnchor}
        initialAnchorRequestId={props.markdownInitialAnchorRequestId}
        // Remount when the panel navigates to another document so soft-keep
        // of prior ready IR cannot flash the previous file's content.
        key={props.documentId}
        labels={props.markdownLabels}
        onContextMenu={props.onMarkdownPreviewContextMenu}
        onJumpToSource={props.onJumpToSource}
        onToggleTask={onToggleTask}
        onToggleWordWrap={onToggleWordWrap}
        openExternal={props.openExternal}
        openInternal={props.onOpenMarkdownInternal}
        panelId={props.panelId}
        registerSelectionSelectAllProvider={
          props.registerSelectionSelectAllProvider
        }
        relativeCommentPath={props.markdownSource?.path}
        searchLabels={props.searchLabels}
        searchRequest={props.searchRequest}
        sessionId={props.editorSessionId}
        source={props.markdownSource}
        tocLabels={props.markdownTocLabels}
        value={props.value}
        worktreeKey={
          props.panelContext?.worktreeKey ??
          props.panelContext?.worktreeRoot ??
          props.panelContext?.gitRoot ??
          props.markdownSource?.root
        }
        zoomLabels={props.markdownZoomLabels}
      />
    );
  }

  if (props.mode === "diff") {
    // originalValue = 磁盘版本(保存冲突 Compare)或最近一次保存的内容。
    if (props.originalValue === undefined) {
      return (
        <FilesFindUnavailableNotice
          context={props.context}
          panelId={props.panelId}
          searchRequest={props.searchRequest}
          t={props.t}
        >
          <UnsupportedFileView label={labels.diffUnsupported} />
        </FilesFindUnavailableNotice>
      );
    }
    return (
      <FilesFindUnavailableNotice
        context={props.context}
        panelId={props.panelId}
        searchRequest={props.searchRequest}
        t={props.t}
      >
        <FilesLineDiff
          currentLabel="editor"
          originalLabel="disk"
          originalValue={props.originalValue}
          value={props.value}
        />
      </FilesFindUnavailableNotice>
    );
  }

  return <CodeMirrorEditor {...props} />;
}

function UnsupportedFileView({ label }: { label: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Construction />
        </EmptyMedia>
        <EmptyTitle>{label}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}
