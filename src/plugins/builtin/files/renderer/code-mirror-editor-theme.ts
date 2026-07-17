import { EditorView } from "codemirror";

// 与终端相同的字体族,字号沿 tw text-[13px] 的比例 (0.8125rem)。CodeMirror
// content 用 var(--font-mono) 让 Zen / 首选设置里改的等宽字体自动同步;
// color 用 inherit 让 :root.light / :root.dark 切换自然生效。
export const EDITOR_THEME = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "inherit",
    height: "100%",
  },
  ".cm-content": {
    caretColor: "currentColor",
    fontFamily: "var(--font-mono)",
    fontSize: "0.8125rem",
    // CJK 字形有较高的 x-height + 无明显 descender,1.55 会让相邻两行紧贴,
    // 视觉上像"重叠"。抬到 1.75 与 Cursor / VSCode 默认接近,同时不至于
    // 拉太散显得空白多。ASCII 也受益,不会撑破 CodeMirror 布局。
    lineHeight: "1.75",
    minHeight: "100%",
    // 内容左 padding 保底 —— gutter 右 padding 之外再多留 8px,避免 fold
    // 折叠符 (▾) 和内容首字符 (`- `、``` ` 等) 挨到一起。
    padding: "0.5rem 0 0.5rem 0.5rem",
  },
  ".cm-line": {
    // 只保留右 padding;左 padding 交给 .cm-content 统一控制,不再叠加。
    paddingLeft: "0",
    paddingRight: "0.75rem",
  },
  ".cm-gutters": {
    // 必须 opaque —— CM 把 gutters position:sticky 钉在左侧,横向滚动时
    // 内容会从下层穿过,gutters 背景透明就会看到内容盖住行号。用编辑器
    // 主体背景色遮挡,与右侧内容视觉无缝。
    backgroundColor: "var(--background)",
    // 无右边框：让变更行 gutter 底色与 content 行底色无缝连贯（CM 官方 styling 做法）。
    borderRight: "none",
    color: "color-mix(in oklab, var(--muted-foreground) 70%, transparent)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.8125rem",
    // 与内容同层的层级不足以完全稳,追加 z-index 保证 sticky gutter 一定盖内容。
    position: "sticky",
    left: 0,
    zIndex: 1,
    userSelect: "none",
  },
  ".cm-gutterElement": {
    padding: "0 0.5rem",
  },
  // fold gutter 单独放宽,给 ▾ 一个真正独立的列宽,避免和内容拼在一起。
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
    // 双轴 auto。CM base theme 只声明 overflowX:auto,浏览器 shorthand 规则
    // 会把 overflowY:visible 补成 auto,但 Chromium 里嵌套 flex 会偶发失效;
    // 显式声明双轴避免 dock view 尺寸变化后 codeMirror 卡在无滚动状态。
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
  // git 变更（官方 + 业界）：
  // 1. gutterLineClass 给该行所有 gutter 槽（行号+fold）铺同色浅底
  // 2. 仅最左 gutter 列（行号）左缘一条实色条（VS Code editorGutter.* 单条强调）
  // 3. content 行 Decoration.line 同色铺底，与 gutter 无缝连贯
  // color-mix 仅允许在此文件（治理白名单）。
  ".cm-gutters .cm-gutterElement.cm-gitRow-added": {
    backgroundColor:
      "color-mix(in oklch, var(--status-success-bg) 90%, transparent)",
  },
  ".cm-gutters .cm-gutterElement.cm-gitRow-modified": {
    backgroundColor:
      "color-mix(in oklch, var(--status-info-bg) 90%, transparent)",
  },
  ".cm-gutters .cm-gutterElement.cm-gitRow-deleted": {
    backgroundColor:
      "color-mix(in oklch, var(--status-danger-bg) 90%, transparent)",
  },
  // 单条强调：只在最左 gutter 列（lineNumbers，basicSetup 中第一个）画 inset 实色条。
  // fold 列只铺浅底，避免出现第二条竖条。
  ".cm-gutters .cm-gutter:first-child .cm-gutterElement.cm-gitRow-added": {
    boxShadow: "inset 3px 0 var(--status-success-fg)",
  },
  ".cm-gutters .cm-gutter:first-child .cm-gutterElement.cm-gitRow-modified": {
    boxShadow: "inset 3px 0 var(--status-info-fg)",
  },
  ".cm-gutters .cm-gutter:first-child .cm-gutterElement.cm-gitRow-deleted": {
    boxShadow: "inset 3px 0 var(--status-danger-fg)",
  },
  ".cm-gitLine-added": {
    backgroundColor:
      "color-mix(in oklch, var(--status-success-bg) 90%, transparent)",
    // 负左 margin 让背景延伸覆盖 content 左 padding（0.5rem），紧贴 gutter 右缘，
    // padding-left 保持文字原位。行底色与 gutter 行槽同色连贯。
    marginLeft: "-0.5rem",
    paddingLeft: "0.5rem",
  },
  ".cm-gitLine-modified": {
    backgroundColor:
      "color-mix(in oklch, var(--status-info-bg) 90%, transparent)",
    marginLeft: "-0.5rem",
    paddingLeft: "0.5rem",
  },
  // minimap（@replit/codemirror-minimap）：库默认 overlay/box-shadow 用了硬编码
  // rgb/hex，这里用语义 token 覆盖，对齐产品颜色治理。
  ".cm-minimap-gutter": {
    backgroundColor: "var(--background)",
    borderLeft: "1px solid var(--border)",
  },
  ".cm-minimap-overlay-container .cm-minimap-overlay": {
    backgroundColor: "color-mix(in oklab, var(--foreground) 20%, transparent)",
    opacity: "1",
  },
  ".cm-minimap-overlay-container .cm-minimap-overlay:hover": {
    backgroundColor: "color-mix(in oklab, var(--foreground) 30%, transparent)",
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
});
