import { CodeMirrorEditor } from "./code-mirror-editor.tsx";
import type { FileEditorAdapterProps } from "./file-editor-adapter-types.ts";
import { FilesLineDiff } from "./files-line-diff.tsx";
import { MarkdownPreview } from "./markdown-preview.tsx";

const DEFAULT_LABELS = {
  diffUnsupported: "Diff view is not enabled yet.",
  richUnsupported: "Rich Markdown editing is not enabled yet.",
  sourceEditor: "Source editor",
};

export function FileEditorAdapter(props: FileEditorAdapterProps) {
  const labels = props.labels ?? DEFAULT_LABELS;

  if (props.mode === "preview") {
    return <MarkdownPreview value={props.value} />;
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

  if (props.mode === "rich") {
    return <UnsupportedFileView label={labels.richUnsupported} />;
  }

  return <CodeMirrorEditor {...props} />;
}

function UnsupportedFileView({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
      {label}
    </div>
  );
}
