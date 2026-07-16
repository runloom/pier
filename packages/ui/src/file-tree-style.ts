import type * as React from "react";
import { PIER_FILE_TREE_ICON_COLOR_OVERRIDES } from "./file-icon-theme.ts";

export type PierFileTreeStyle = React.CSSProperties & {
  [key: `--trees-file-icon-color-${string}`]: string | undefined;
  "--trees-accent-override"?: string;
  "--trees-bg-muted-override"?: string;
  "--trees-bg-override"?: string;
  "--trees-border-color-override"?: string;
  "--trees-fg-muted-override"?: string;
  "--trees-fg-override"?: string;
  "--trees-focus-ring-color-override"?: string;
  "--trees-font-family-override"?: string;
  "--trees-git-added-color-override"?: string;
  "--trees-git-deleted-color-override"?: string;
  "--trees-git-ignored-color-override"?: string;
  "--trees-git-modified-color-override"?: string;
  "--trees-git-renamed-color-override"?: string;
  "--trees-git-untracked-color-override"?: string;
  "--trees-input-bg-override"?: string;
  "--trees-padding-inline-override"?: string;
  "--trees-scrollbar-gutter-override"?: string;
  "--trees-scrollbar-thumb-override"?: string;
  "--trees-search-bg-override"?: string;
  "--trees-search-fg-override"?: string;
  "--trees-selected-bg-override"?: string;
  "--trees-selected-fg-override"?: string;
};

// @pierre/trees 在 Shadow DOM 内自行绘制滚动条和行布局。
// 通过其官方 unsafeCSS 入口补齐 Pier 的滚动条视觉，并让空装饰列不抢占文件名宽度。
export const TREE_SCROLLBAR_CSS = `
[data-item-section="content"] {
  flex: 1 1 auto;
}

[data-item-section="decoration"]:empty {
  flex: 0 0 0;
}

[data-item-section="decoration"]:not(:empty) {
  flex: 0 1 auto;
}

[data-item-section="git"]:empty,
[data-item-section="action"]:empty {
  display: none;
}

[data-file-tree-virtualized-scroll="true"],
[data-file-tree-scrollbar-measure="true"] {
  --trees-scrollbar-thumb-current: transparent;
  scrollbar-color: var(--trees-scrollbar-thumb-current) var(--shell-scrollbar-track);
  scrollbar-width: var(--shell-scrollbar-width);
}

[data-file-tree-virtualized-scroll="true"][data-scrollbar-scrolling="true"],
[data-file-tree-virtualized-scroll="true"][data-scrollbar-hovering="true"] {
  --trees-scrollbar-thumb-current: var(--shell-scrollbar-thumb);
}

[data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar-thumb {
  border-radius: var(--shell-scrollbar-radius);
  transition: background-color 160ms ease-out;
}

[data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar-thumb:active {
  background-color: var(--shell-scrollbar-thumb-active);
}

[data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar-track {
  background: var(--shell-scrollbar-track);
}

[data-file-tree-virtualized-scroll="true"]::-webkit-scrollbar-corner {
  background: var(--shell-scrollbar-corner);
}
`;

export function pierFileTreeStyle(
  style: React.CSSProperties | undefined
): PierFileTreeStyle {
  return {
    ...PIER_FILE_TREE_ICON_COLOR_OVERRIDES,
    "--trees-bg-override": "var(--sidebar)",
    "--trees-fg-override": "var(--sidebar-foreground)",
    "--trees-fg-muted-override": "var(--muted-foreground)",
    "--trees-bg-muted-override": "var(--interactive-hover)",
    "--trees-input-bg-override": "var(--muted)",
    "--trees-padding-inline-override": "4px",
    "--trees-border-color-override": "var(--sidebar-border)",
    "--trees-focus-ring-color-override": "var(--ring)",
    "--trees-accent-override": "var(--primary)",
    "--trees-selected-bg-override": "var(--sidebar-accent)",
    "--trees-selected-fg-override": "var(--sidebar-accent-foreground)",
    "--trees-search-bg-override": "var(--muted)",
    "--trees-search-fg-override": "var(--foreground)",
    "--trees-font-family-override": "var(--pier-mono-font-family)",
    "--trees-git-added-color-override": "var(--success)",
    "--trees-git-modified-color-override": "var(--info)",
    "--trees-git-deleted-color-override": "var(--destructive)",
    "--trees-git-renamed-color-override": "var(--warning)",
    "--trees-git-untracked-color-override": "var(--success)",
    "--trees-git-ignored-color-override": "var(--muted-foreground)",
    "--trees-scrollbar-gutter-override": "var(--shell-scrollbar-width-legacy)",
    "--trees-scrollbar-thumb-override": "var(--shell-scrollbar-thumb)",
    ...style,
  };
}
