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
    // 设置「代码字号」经 font.store 写入 --pier-code-font-size。
    fontSize: "var(--pier-code-font-size, 13px)",
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
    fontSize: "var(--pier-code-font-size, 13px)",
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
    backgroundColor: "var(--editor-active-line-bg)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "var(--editor-selection-bg)",
    },
  /*
   * Occurrence / find chrome: consume --editor-* decoration tokens only.
   * Tokens live in globals.css (and ride style-preset --foreground/--info).
   * Do not paint status hues (--success/--warning/…) as solid mark fills —
   * those are syntax foregrounds and clash under type/string/keyword text.
   * @codemirror/search neon defaults are overridden here.
   */
  ".cm-selectionMatch": {
    backgroundColor: "var(--editor-selection-match-bg)",
    borderRadius: "2px",
  },
  ".cm-selectionMatch-main": {
    backgroundColor: "var(--editor-selection-match-main-bg)",
    borderRadius: "2px",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--editor-search-match-bg)",
    borderRadius: "2px",
    boxShadow: "inset 0 -2px 0 0 var(--editor-search-match-border)",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "var(--editor-search-match-active-bg)",
    borderRadius: "2px",
    boxShadow: "inset 0 0 0 1.5px var(--editor-search-match-active-border)",
  },
  // When find and selection-match overlap, search owns the paint (CM default contract).
  ".cm-searchMatch .cm-selectionMatch": {
    backgroundColor: "transparent",
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
  /*
   * Lint / LSP serverDiagnostics tooltips: same chrome contract as
   * .cm-lsp-hover-tooltip (mono, code size, wrap, semantic severity rail).
   * Overrides @codemirror/lint baseTheme hard-coded severity colors.
   */
  ".cm-tooltip-lint": {
    padding: "0",
    margin: "0",
    maxWidth: "min(480px, 90vw)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--pier-code-font-size, 13px)",
    lineHeight: "1.75",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "0.375rem",
    boxShadow:
      "0 4px 16px color-mix(in oklab, var(--foreground) 12%, transparent)",
    overflow: "hidden",
  },
  ".cm-diagnostic": {
    padding: "0.375rem 0.5rem 0.375rem 0.625rem",
    marginLeft: "0",
    display: "block",
    maxWidth: "min(480px, 90vw)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
    borderLeft: "3px solid var(--muted-foreground)",
  },
  ".cm-diagnosticText": {
    display: "block",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  ".cm-diagnostic-error": {
    borderLeftColor: "var(--destructive)",
  },
  ".cm-diagnostic-warning": {
    borderLeftColor: "var(--warning)",
  },
  ".cm-diagnostic-info": {
    borderLeftColor: "var(--info)",
  },
  ".cm-diagnostic-hint": {
    borderLeftColor: "var(--muted-foreground)",
  },
  ".cm-diagnosticSource": {
    marginTop: "0.25rem",
    fontSize: "0.85em",
    opacity: "0.75",
    color: "var(--muted-foreground)",
  },
  ".cm-diagnosticAction": {
    font: "inherit",
    fontSize: "0.9em",
    border: "1px solid var(--border)",
    padding: "0.125rem 0.375rem",
    marginLeft: "0.5rem",
    marginTop: "0.25rem",
    borderRadius: "0.25rem",
    cursor: "pointer",
    backgroundColor: "var(--secondary)",
    color: "var(--secondary-foreground)",
  },
  ".cm-diagnosticAction:hover": {
    backgroundColor:
      "color-mix(in oklab, var(--secondary) 85%, var(--foreground))",
  },
  /* Pier LSP hover mounts a transparent CM tooltip shell; chrome is on .cm-lsp-hover-tooltip. */
  ".cm-tooltip:has([data-slot='files-lsp-hover-tooltip-root'])": {
    backgroundColor: "transparent",
    border: "none",
    padding: "0",
    boxShadow: "none",
  },
  /*
   * Hover documentation: match editor code metrics (mono, size, line-height).
   * Syntax colors via tok-* (classHighlighter) and/or CM StyleModule classes.
   * No gray code slabs.
   */
  ".cm-lsp-hover-tooltip": {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--pier-code-font-size, 13px)",
    lineHeight: "1.75",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "0.375rem",
    boxShadow:
      "0 4px 16px color-mix(in oklab, var(--foreground) 12%, transparent)",
  },
  ".cm-lsp-hover-tooltip .cm-lsp-hover-signature, .cm-lsp-hover-tooltip .cm-lsp-code, .cm-lsp-hover-tooltip .cm-lsp-documentation":
    {
      margin: "0",
      padding: "0",
      background: "transparent",
      fontFamily: "inherit",
      fontSize: "inherit",
      lineHeight: "inherit",
    },
  ".cm-lsp-hover-tooltip .cm-lsp-hover-signature pre, .cm-lsp-hover-tooltip .cm-lsp-documentation pre, .cm-lsp-hover-tooltip pre.cm-lsp-code":
    {
      margin: "0",
      padding: "0",
      background: "transparent",
      border: "none",
      fontFamily: "inherit",
      fontSize: "inherit",
      lineHeight: "inherit",
      whiteSpace: "pre-wrap",
      overflowX: "auto",
    },
  ".cm-lsp-hover-tooltip .cm-lsp-hover-signature code, .cm-lsp-hover-tooltip .cm-lsp-documentation code, .cm-lsp-hover-tooltip .cm-lsp-code code":
    {
      fontFamily: "inherit",
      fontSize: "inherit",
      lineHeight: "inherit",
      background: "transparent",
      padding: "0",
    },
  ".cm-lsp-hover-tooltip .cm-lsp-hover-signature + .cm-lsp-documentation, .cm-lsp-hover-tooltip [data-slot='files-lsp-hover-signature'] + .cm-lsp-documentation":
    {
      marginTop: "0.5rem",
      paddingTop: "0.5rem",
      borderTop: "1px solid var(--border)",
    },
  ".cm-lsp-hover-tooltip .cm-lsp-documentation > :first-child": {
    marginTop: "0",
  },
  ".cm-lsp-hover-tooltip .cm-lsp-documentation > :last-child": {
    marginBottom: "0",
  },
  ".cm-lsp-hover-tooltip .cm-lsp-documentation p": {
    margin: "0.25rem 0",
  },
  ".cm-lsp-hover-tooltip .cm-lsp-documentation ul, .cm-lsp-hover-tooltip .cm-lsp-documentation ol":
    {
      margin: "0.25rem 0",
      paddingLeft: "1.15rem",
    },
  ".cm-lsp-hover-tooltip .cm-lsp-documentation li": {
    margin: "0.1rem 0",
  },
  ".cm-lsp-hover-tooltip .cm-lsp-documentation pre": {
    margin: "0.35rem 0",
  },
  ".cm-lsp-hover-tooltip .cm-lsp-documentation a": {
    color: "var(--primary)",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  ".cm-lsp-hover-tooltip .cm-lsp-documentation h1, .cm-lsp-hover-tooltip .cm-lsp-documentation h2, .cm-lsp-hover-tooltip .cm-lsp-documentation h3, .cm-lsp-hover-tooltip .cm-lsp-documentation h4":
    {
      margin: "0.4rem 0 0.2rem",
      fontSize: "inherit",
      fontWeight: "600",
      lineHeight: "inherit",
    },
  /* classHighlighter tok-* palette (mirrors pierSyntaxHighlightStyle). */
  ".cm-lsp-hover-tooltip .tok-comment, .cm-lsp-hover-tooltip .tok-meta": {
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
  ".cm-lsp-hover-tooltip .tok-string, .cm-lsp-hover-tooltip .tok-escape": {
    color: "var(--success)",
  },
  ".cm-lsp-hover-tooltip .tok-number, .cm-lsp-hover-tooltip .tok-bool, .cm-lsp-hover-tooltip .tok-atom, .cm-lsp-hover-tooltip .tok-null":
    {
      color: "var(--info)",
    },
  ".cm-lsp-hover-tooltip .tok-keyword, .cm-lsp-hover-tooltip .tok-modifier, .cm-lsp-hover-tooltip .tok-moduleKeyword":
    {
      color: "var(--done)",
    },
  ".cm-lsp-hover-tooltip .tok-operator": {
    color: "var(--foreground)",
  },
  ".cm-lsp-hover-tooltip .tok-punctuation, .cm-lsp-hover-tooltip .tok-paren, .cm-lsp-hover-tooltip .tok-squareBracket, .cm-lsp-hover-tooltip .tok-brace, .cm-lsp-hover-tooltip .tok-separator, .cm-lsp-hover-tooltip .tok-angleBracket":
    {
      color: "var(--muted-foreground)",
    },
  ".cm-lsp-hover-tooltip .tok-variableName, .cm-lsp-hover-tooltip .tok-propertyName, .cm-lsp-hover-tooltip .tok-name, .cm-lsp-hover-tooltip .tok-definition":
    {
      color: "var(--foreground)",
    },
  ".cm-lsp-hover-tooltip .tok-typeName, .cm-lsp-hover-tooltip .tok-className, .cm-lsp-hover-tooltip .tok-namespace, .cm-lsp-hover-tooltip .tok-labelName, .cm-lsp-hover-tooltip .tok-macroName, .cm-lsp-hover-tooltip .tok-tagName":
    {
      color: "var(--warning)",
    },
  ".cm-lsp-hover-tooltip .tok-function, .cm-lsp-hover-tooltip .tok-standard": {
    color: "var(--info)",
  },
  ".cm-lsp-hover-tooltip .tok-invalid": {
    color: "var(--destructive)",
  },
  ".cm-lsp-definition-preview": {
    borderRadius: "0",
    background: "transparent",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--pier-code-font-size, 13px)",
    lineHeight: "1.75",
  },
  ".cm-lsp-definition-preview-target-line": {
    backgroundColor: "color-mix(in oklab, var(--info) 12%, transparent)",
  },
  ".cm-lsp-definition-target": {
    color: "inherit",
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
  },
  ".cm-lsp-definition-target:hover, .cm-lsp-definition-target:focus-visible": {
    backgroundColor: "color-mix(in oklab, var(--foreground) 8%, transparent)",
  },
  ".cm-lsp-definition-target-active": {
    backgroundColor: "color-mix(in oklab, var(--info) 14%, transparent)",
  },
  ".cm-lsp-definition-location": {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
  },
  /* Cursor only — continuous underline is .cm-lsp-definition-affordance-rect */
  ".cm-lsp-definition-affordance": {
    cursor: "pointer",
  },
  ".cm-lsp-definition-affordance-layer": {
    pointerEvents: "none",
  },
  /*
   * Full-height range rect with bottom border: stays continuous across
   * syntax-highlight splits (unlike text-decoration on nested spans).
   */
  ".cm-lsp-definition-affordance-rect": {
    borderBottom: "1px solid var(--info)",
    boxSizing: "border-box",
    pointerEvents: "none",
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
    fontSize: "var(--pier-code-font-size, 13px)",
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
    backgroundColor: "var(--editor-active-line-bg)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "var(--editor-selection-bg)",
    },
  ".cm-selectionMatch": {
    backgroundColor: "var(--editor-selection-match-bg)",
    borderRadius: "2px",
  },
  ".cm-selectionMatch-main": {
    backgroundColor: "var(--editor-selection-match-main-bg)",
    borderRadius: "2px",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--editor-search-match-bg)",
    borderRadius: "2px",
    boxShadow: "inset 0 -2px 0 0 var(--editor-search-match-border)",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "var(--editor-search-match-active-bg)",
    borderRadius: "2px",
    boxShadow: "inset 0 0 0 1.5px var(--editor-search-match-active-border)",
  },
  ".cm-searchMatch .cm-selectionMatch": {
    backgroundColor: "transparent",
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
