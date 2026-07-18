/**
 * Shadow DOM 滚动条：与 globals.css 同 token、同视觉。
 *
 * light DOM 已由 `*` 全局样式覆盖；Shadow 穿不进，只能 unsafeCSS 再挂一份。
 * 槽位 --shell-scrollbar-width-legacy；拇指 1px 透明边 + content-box。
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
  scrollbar-color: var(--shell-scrollbar-thumb) var(--shell-scrollbar-track, transparent);
  scrollbar-width: var(--shell-scrollbar-width, thin);
}

@supports selector(::-webkit-scrollbar) {
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
