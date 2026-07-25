import { pierEditorTheme } from "@shared/source-editor/editor-theme.ts";
import { EditorView } from "codemirror";

// Files editor chrome: shared Pier palette + git gutter markers + minimap tokens.
export const EDITOR_THEME = [
  pierEditorTheme,
  EditorView.theme({
    // git 变更：Files 插件只画最左 gutter 边条，不铺行背景 / gutter 槽底色。
    ".cm-gutters .cm-gutter:first-child .cm-gutterElement.cm-gitRow-added": {
      boxShadow: "inset 3px 0 var(--diff-addition-fg)",
    },
    ".cm-gutters .cm-gutter:first-child .cm-gutterElement.cm-gitRow-modified": {
      boxShadow: "inset 3px 0 var(--diff-modification-fg)",
    },
    ".cm-gutters .cm-gutter:first-child .cm-gutterElement.cm-gitRow-deleted": {
      boxShadow: "inset 3px 0 var(--diff-deletion-fg)",
    },
    // minimap（@replit/codemirror-minimap）：库默认 overlay/box-shadow 用了硬编码
    // rgb/hex，这里用语义 token 覆盖，对齐产品颜色治理。
    ".cm-minimap-gutter": {
      backgroundColor: "var(--background)",
      borderLeft: "1px solid var(--border)",
    },
    ".cm-minimap-overlay-container .cm-minimap-overlay": {
      backgroundColor:
        "color-mix(in oklab, var(--foreground) 20%, transparent)",
      opacity: "1",
    },
    ".cm-minimap-overlay-container .cm-minimap-overlay:hover": {
      backgroundColor:
        "color-mix(in oklab, var(--foreground) 30%, transparent)",
    },
    ".cm-minimap-overlay-container.cm-minimap-overlay-active .cm-minimap-overlay":
      {
        backgroundColor:
          "color-mix(in oklab, var(--foreground) 40%, transparent)",
      },
    ".cm-minimap-box-shadow": {
      boxShadow:
        "12px 0 20px 5px color-mix(in oklab, var(--foreground) 18%, transparent)",
    },
  }),
];
