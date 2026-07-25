import { EditorView } from "@codemirror/view";

/**
 * Shared CodeMirror chrome aligned with Pier semantic tokens.
 * Files keeps gutters/minimap extras on top; settings source editors
 * use {@link settingsSourceEditorTheme} (no line numbers, wrap-friendly).
 */
export const pierEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "inherit",
    height: "100%",
  },
  ".cm-content": {
    caretColor: "currentColor",
    fontFamily: "var(--font-mono)",
    fontSize: "0.8125rem",
    lineHeight: "1.75",
    minHeight: "100%",
    outline: "none",
    padding: "0.5rem 0 0.5rem 0.5rem",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-line": {
    paddingLeft: "0",
    paddingRight: "0.75rem",
  },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    borderRight: "none",
    color: "color-mix(in oklab, var(--muted-foreground) 70%, transparent)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.8125rem",
    position: "sticky",
    left: 0,
    zIndex: 1,
    userSelect: "none",
  },
  ".cm-gutterElement": {
    padding: "0 0.5rem",
  },
  ".cm-foldGutter .cm-gutterElement": {
    minWidth: "1rem",
    padding: "0 0.25rem",
    textAlign: "center",
  },
  ".cm-activeLineGutter, .cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--foreground) 6%, transparent)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "color-mix(in oklab, var(--info) 25%, transparent)",
    },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    overflowX: "auto",
    overflowY: "auto",
  },
  ".cm-panels": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    borderBottom: "1px solid var(--border)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "0.5rem",
  },
});

/** Settings Rules/Skills: same palette/chrome as files, no gutter column. */
export const settingsSourceEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "inherit",
    height: "100%",
    minHeight: "15rem",
  },
  ".cm-content": {
    caretColor: "currentColor",
    fontFamily: "var(--font-mono)",
    fontSize: "0.8125rem",
    lineHeight: "1.75",
    minHeight: "15rem",
    outline: "none",
    padding: "0.75rem",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-line": {
    paddingLeft: "0",
    paddingRight: "0",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--foreground) 6%, transparent)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "color-mix(in oklab, var(--info) 25%, transparent)",
    },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    overflowX: "hidden",
    overflowY: "auto",
  },
});

/**
 * Stack on {@link settingsSourceEditorTheme}: grow with the document so the
 * surrounding dialog/page scrolls instead of a nested CodeMirror scrollbar.
 */
export const settingsSourceEditorAutoHeightTheme = EditorView.theme({
  "&": {
    height: "auto",
    minHeight: "15rem",
  },
  ".cm-scroller": {
    overflowY: "hidden",
  },
});
