/**
 * Shadow DOM 滚动条：与 globals.css 同策略、同 token。
 *
 * light DOM 已由全局样式覆盖；Shadow 穿不进，只能 unsafeCSS 再挂一份。
 *
 * Electron：用 scrollbar-color 空闲透明 / 活动着色做自动隐藏，并固定
 * scrollbar-width: thin，避免与 @pierre/trees 自带 webkit :hover 条打架，
 * 也避免退回经典 webkit 槽位导致 gutter 位移。
 *
 * trees `:hover` 会把 `--trees-scrollbar-thumb-current` 设成亮色。unsafe
 * 层必须把该变量钉在透明，只在 Pier 活动位（滚动 / 槽位悬停）交给产品 token。
 */

export const SCROLLBAR_SIZE_CSS = "var(--shell-scrollbar-width-legacy)";

/** 注入 trees / diffs Shadow。 */
export const SCROLLBAR_SYSTEM_CSS = `
:host {
  --trees-scrollbar-gutter-override: ${SCROLLBAR_SIZE_CSS};
  --diffs-scrollbar-gutter-override: ${SCROLLBAR_SIZE_CSS};
}

[data-file-tree-virtualized-scroll="true"],
[data-file-tree-scrollbar-measure="true"],
[data-code],
:host {
  --trees-scrollbar-thumb-current: transparent;
  scrollbar-color: transparent transparent;
  scrollbar-width: var(--shell-scrollbar-width, thin);
}

[data-file-tree-virtualized-scroll="true"]:hover,
[data-file-tree-scrollbar-measure="true"]:hover {
  --trees-scrollbar-thumb-current: transparent;
}

[data-file-tree-virtualized-scroll="true"][data-scrollbar-scrolling="true"],
[data-file-tree-virtualized-scroll="true"][data-scrollbar-hovering="true"],
[data-code][data-scrollbar-scrolling="true"],
[data-code][data-scrollbar-hovering="true"] {
  --trees-scrollbar-thumb-current: var(--shell-scrollbar-thumb);
  scrollbar-color: var(--shell-scrollbar-thumb) var(--shell-scrollbar-track, transparent);
}

@supports not (scrollbar-color: auto) {
  [data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar,
  [data-file-tree-scrollbar-measure="true"]::-webkit-scrollbar,
  [data-code]::-webkit-scrollbar,
  :host::-webkit-scrollbar {
    -webkit-appearance: none;
    width: ${SCROLLBAR_SIZE_CSS};
    height: ${SCROLLBAR_SIZE_CSS};
  }

  [data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar:vertical,
  [data-file-tree-scrollbar-measure="true"]::-webkit-scrollbar:vertical,
  [data-code]::-webkit-scrollbar:vertical,
  :host::-webkit-scrollbar:vertical {
    width: ${SCROLLBAR_SIZE_CSS};
  }

  [data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar:horizontal,
  [data-file-tree-scrollbar-measure="true"]::-webkit-scrollbar:horizontal,
  [data-code]::-webkit-scrollbar:horizontal,
  :host::-webkit-scrollbar:horizontal {
    height: ${SCROLLBAR_SIZE_CSS};
  }

  [data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar-thumb,
  [data-file-tree-scrollbar-measure="true"]::-webkit-scrollbar-thumb,
  [data-code]::-webkit-scrollbar-thumb,
  :host::-webkit-scrollbar-thumb {
    border: 1px solid transparent;
    border-radius: var(--shell-scrollbar-radius, 999px);
    background: transparent;
    background-clip: content-box;
  }

  [data-file-tree-virtualized-scroll="true"][data-scrollbar-scrolling="true"]::-webkit-scrollbar-thumb,
  [data-file-tree-virtualized-scroll="true"][data-scrollbar-hovering="true"]::-webkit-scrollbar-thumb,
  [data-code][data-scrollbar-scrolling="true"]::-webkit-scrollbar-thumb,
  [data-code][data-scrollbar-hovering="true"]::-webkit-scrollbar-thumb {
    background: var(--shell-scrollbar-thumb);
    background-clip: content-box;
  }

  [data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar-thumb:active,
  [data-code]::-webkit-scrollbar-thumb:active,
  :host::-webkit-scrollbar-thumb:active {
    background: var(--shell-scrollbar-thumb-active);
    background-clip: content-box;
  }

  [data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar-track,
  [data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar-corner,
  [data-code]::-webkit-scrollbar-track,
  [data-code]::-webkit-scrollbar-corner,
  :host::-webkit-scrollbar-track,
  :host::-webkit-scrollbar-corner {
    background: var(--shell-scrollbar-track, transparent);
  }
}
`;
