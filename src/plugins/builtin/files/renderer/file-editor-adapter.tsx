import { CodeMirrorEditor } from "./code-mirror-editor.tsx";
import type { FileEditorAdapterProps } from "./files-document-types.ts";
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
    return <UnsupportedFileView label={labels.diffUnsupported} />;
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
