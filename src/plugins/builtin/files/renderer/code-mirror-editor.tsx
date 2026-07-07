import { markdown } from "@codemirror/lang-markdown";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef } from "react";
import type { FileEditorAdapterProps } from "./files-document-types.ts";

export function CodeMirrorEditor({
  labels,
  language,
  onChange,
  readOnly = false,
  value,
}: FileEditorAdapterProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const latestValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const syncingExternalValueRef = useRef(false);
  const viewRef = useRef<EditorView | null>(null);

  latestValueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const extensions = [
      basicSetup,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        "aria-label": labels?.sourceEditor ?? "Source editor",
      }),
      EditorView.editorAttributes.of({ class: "h-full" }),
      EditorView.theme({
        "&": {
          backgroundColor: "transparent",
          color: "inherit",
          height: "100%",
        },
        ".cm-content": {
          caretColor: "currentColor",
          fontFamily: "var(--font-mono)",
          fontSize: "0.8125rem",
          lineHeight: "1.5",
          minHeight: "100%",
          padding: "0.75rem",
        },
        ".cm-gutters": {
          backgroundColor: "transparent",
          borderRightColor: "var(--border)",
          color: "var(--muted-foreground)",
        },
        ".cm-line": {
          padding: "0 0.25rem",
        },
        ".cm-scroller": {
          fontFamily: "var(--font-mono)",
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || syncingExternalValueRef.current) {
          return;
        }
        onChangeRef.current?.(update.state.doc.toString());
      }),
      EditorView.editable.of(!readOnly),
    ];

    if (language === "markdown") {
      extensions.push(markdown());
    }

    const view = new EditorView({
      parent: container,
      doc: latestValueRef.current,
      extensions,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      if (viewRef.current === view) {
        viewRef.current = null;
      }
    };
  }, [labels?.sourceEditor, language, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      return;
    }

    syncingExternalValueRef.current = true;
    view.dispatch({
      changes: { from: 0, insert: value, to: currentValue.length },
    });
    syncingExternalValueRef.current = false;
  }, [value]);

  return (
    <div
      className="min-h-0 flex-1 overflow-hidden bg-background text-foreground"
      data-testid="files-code-mirror-editor"
      ref={containerRef}
    />
  );
}
