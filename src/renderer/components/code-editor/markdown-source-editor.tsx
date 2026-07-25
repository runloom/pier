import { syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cn } from "@pier/ui/utils.ts";
import {
  settingsSourceEditorAutoHeightTheme,
  settingsSourceEditorTheme,
} from "@shared/source-editor/editor-theme.ts";
import { pierMarkdownLanguage } from "@shared/source-editor/markdown-language.ts";
import { pierSyntaxHighlightStyle } from "@shared/source-editor/syntax-highlight-style.ts";
import { minimalSetup } from "codemirror";
import { useEffect, useRef } from "react";

/**
 * Shared Markdown source editor for Rules / Skills (edit + read-only preview).
 * YAML frontmatter + GFM + nested fenced-code; no line numbers; soft-wrap.
 *
 * `autoHeight`: grow with the document so a parent scroller (content dialog
 * body) owns vertical scroll — use in skill open dialogs. Default fills the
 * host and scrolls inside CodeMirror (Rules panel).
 */
export function MarkdownSourceEditor({
  ariaLabel,
  autoHeight = false,
  className,
  onChange,
  readOnly = false,
  value,
}: {
  ariaLabel: string;
  autoHeight?: boolean;
  className?: string;
  onChange?: (next: string) => void;
  readOnly?: boolean;
  value: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableCompartment = useRef(new Compartment());
  const ariaCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const syncingRef = useRef(false);
  onChangeRef.current = onChange;

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once CodeMirror; value/readOnly/aria synced below
  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          minimalSetup,
          pierMarkdownLanguage(),
          // Primary (non-fallback) — matches files; wins over minimalSetup defaults.
          syntaxHighlighting(pierSyntaxHighlightStyle),
          settingsSourceEditorTheme,
          ...(autoHeight ? [settingsSourceEditorAutoHeightTheme] : []),
          EditorView.lineWrapping,
          editableCompartment.current.of(EditorView.editable.of(!readOnly)),
          ariaCompartment.current.of(
            EditorView.contentAttributes.of({ "aria-label": ariaLabel })
          ),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || syncingRef.current) return;
            onChangeRef.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.scrollDOM.dataset.scrollbar = "overlay";
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    syncingRef.current = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
    syncingRef.current = false;
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        editableCompartment.current.reconfigure(
          EditorView.editable.of(!readOnly)
        ),
        ariaCompartment.current.reconfigure(
          EditorView.contentAttributes.of({ "aria-label": ariaLabel })
        ),
      ],
    });
  }, [readOnly, ariaLabel]);

  return (
    <div
      className={cn(
        "min-h-60 rounded-2xl border border-transparent bg-input/50 outline-none transition-[color,box-shadow] duration-200",
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
        autoHeight ? "overflow-visible" : "overflow-hidden",
        className
      )}
      ref={hostRef}
    />
  );
}
