import { pierEditorTheme } from "@shared/source-editor/theme.ts";
import { EditorView } from "codemirror";
import { FILES_EDITOR_END_INSET_PX } from "./layout.ts";

// Files editor chrome: shared Pier palette + git gutter markers + minimap tokens.
export const EDITOR_THEME = [
  pierEditorTheme,
  EditorView.theme({
    ".cm-line": {
      paddingRight: `var(--files-editor-end-inset, ${FILES_EDITOR_END_INSET_PX}px)`,
    },
    // git 变更：行号右侧独立色条（可点）；默认 3px，hover 加粗到 5px。
    // 不铺行背景。padding 清零，避免继承行号轨的横向内边距。
    ".cm-git-gutter": {
      width: "16px",
      minWidth: "16px",
      cursor: "pointer",
    },
    ".cm-git-gutter .cm-gutterElement": {
      position: "relative",
      boxSizing: "border-box",
      cursor: "pointer",
      minWidth: "16px",
      padding: "0",
      transition: "box-shadow 80ms ease-out",
    },
    ".cm-git-gutter .cm-gutterElement.cm-gitRow-added": {
      boxShadow: "inset 3px 0 0 0 var(--diff-addition-fg)",
    },
    ".cm-git-gutter .cm-gutterElement.cm-gitRow-modified": {
      boxShadow: "inset 3px 0 0 0 var(--diff-modification-fg)",
    },
    ".cm-git-gutter .cm-gutterElement.cm-gitRow-deleted::before": {
      content: '""',
      position: "absolute",
      top: "0",
      left: "0",
      width: "8px",
      height: "3px",
      backgroundColor: "var(--diff-deletion-fg)",
    },
    ".cm-git-gutter .cm-gutterElement.cm-gitRow-added:hover": {
      boxShadow: "inset 5px 0 0 0 var(--diff-addition-fg)",
    },
    ".cm-git-gutter .cm-gutterElement.cm-gitRow-modified:hover": {
      boxShadow: "inset 5px 0 0 0 var(--diff-modification-fg)",
    },
    ".cm-git-gutter .cm-gutterElement.cm-gitRow-deleted:hover::before": {
      height: "5px",
    },

    // minimap（@replit/codemirror-minimap）：库默认 overlay/box-shadow 用了硬编码
    // rgb/hex，这里用语义 token 覆盖，对齐产品颜色治理。
    ".cm-minimap-gutter": {
      backgroundColor: "var(--background)",
      borderLeft:
        "1px solid color-mix(in oklab, var(--border) 65%, transparent)",
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
