import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@pier/ui/empty.tsx";
import { Construction } from "lucide-react";
import { CodeMirrorEditor } from "./code-mirror-editor.tsx";
import type { FileEditorAdapterProps } from "./file-editor-adapter-types.ts";
import { FilesLineDiff } from "./files-line-diff.tsx";
import { MarkdownPreview } from "./markdown-preview.tsx";

const DEFAULT_LABELS = {
  diffUnsupported: "No disk contents available to compare.",
  sourceEditor: "Source editor",
};

export function FileEditorAdapter(props: FileEditorAdapterProps) {
  const labels = props.labels ?? DEFAULT_LABELS;

  if (props.mode === "preview") {
    return (
      <MarkdownPreview
        appearance={props.markdownAppearance}
        charts={props.markdownCharts}
        copyCode={props.markdownCopyCode}
        errorLabel={props.markdownErrorLabel}
        fileResources={props.markdownFileResources}
        initialAnchor={props.markdownInitialAnchor}
        initialAnchorRequestId={props.markdownInitialAnchorRequestId}
        labels={props.markdownLabels}
        onContextMenu={props.onMarkdownPreviewContextMenu}
        onJumpToSource={props.onJumpToSource}
        openExternal={props.openExternal}
        openInternal={props.onOpenMarkdownInternal}
        panelId={props.panelId}
        registerSelectionSelectAllProvider={
          props.registerSelectionSelectAllProvider
        }
        searchLabels={props.searchLabels}
        searchRequest={props.searchRequest}
        sessionId={props.editorSessionId}
        source={props.markdownSource}
        tocLabels={props.markdownTocLabels}
        value={props.value}
        zoomLabels={props.markdownZoomLabels}
      />
    );
  }

  if (props.mode === "diff") {
    // originalValue = 磁盘版本(保存冲突 Compare)或最近一次保存的内容。
    if (props.originalValue === undefined) {
      return <UnsupportedFileView label={labels.diffUnsupported} />;
    }
    return (
      <FilesLineDiff
        currentLabel="editor"
        originalLabel="disk"
        originalValue={props.originalValue}
        value={props.value}
      />
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
