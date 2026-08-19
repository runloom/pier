import type * as React from "react";
import { scrollFadeUnsafeCss } from "../scroll-area.tsx";
import { SCROLLBAR_SYSTEM_CSS } from "../scrollbar-system.ts";
import { PIER_FILE_TREE_ICON_COLOR_OVERRIDES } from "./icon-theme.ts";

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
  "--trees-selected-focused-border-color-override"?: string;
};

/**
 * PierFileTree outer bridge: vertical inset without changing row height.
 * Pair with {@link FILE_TREE_SEARCH_SHELL_CLASS} (search has no bottom pad).
 */
export const FILE_TREE_BRIDGE_CLASS =
  "flex h-full min-h-0 w-full flex-col py-1";

/** Host fills remaining height inside the bridge. */
export const FILE_TREE_HOST_CLASS = "min-h-0 w-full flex-1";

/**
 * Chrome wrapping the tree search bar above {@link PierFileTree}.
 * Bottom pad is 0 so {@link FILE_TREE_BRIDGE_CLASS} `py-1` owns the single
 * gap between search and the first row (no double spacing).
 */
export const FILE_TREE_SEARCH_SHELL_CLASS = "shrink-0 px-2 pt-1 pb-0";

const FILE_TREE_SCROLL_SELECTOR = '[data-file-tree-virtualized-scroll="true"]';

/**
 * trees Shadow unsafeCSS bag:
 * 1) layout empty lanes
 * 2) SCROLLBAR_SYSTEM_CSS (same tokens as globals)
 * 3) short vertical scroll-fade; union an opaque gutter mask so the
 *    native thumb stays painted (do not shrink mask-size)
 */
export const TREE_SHADOW_CSS = `
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

/* Pier canvas token is not in @pierre/trees built-in colored-icon CSS. */
[data-file-tree-colored-icons="true"] [data-icon-token="canvas"] {
  color: var(--trees-file-icon-color-canvas);
}

${SCROLLBAR_SYSTEM_CSS}

${scrollFadeUnsafeCss({
  selector: FILE_TREE_SCROLL_SELECTOR,
  fade: "vertical",
  profile: "short",
  spareNativeScrollbar: "inline-end",
})}
`;

/** Alias of {@link TREE_SHADOW_CSS} (historical name). Prefer TREE_SHADOW_CSS in new code. */
export const TREE_SCROLLBAR_CSS = TREE_SHADOW_CSS;

export function pierFileTreeStyle(
  style: React.CSSProperties | undefined
): PierFileTreeStyle {
  return {
    ...PIER_FILE_TREE_ICON_COLOR_OVERRIDES,
    "--trees-bg-override": "var(--sidebar)",
    "--trees-fg-override": "var(--sidebar-foreground)",
    "--trees-fg-muted-override": "var(--muted-foreground)",
    // Sidebar list wash tokens (globals.css): calibrated for muted chrome,
    // light/dark split. Do not reuse canvas --interactive-* (wrong base).
    "--trees-bg-muted-override": "var(--list-hover-bg)",
    "--trees-input-bg-override": "var(--muted)",
    "--trees-padding-inline-override": "4px",
    "--trees-border-color-override": "var(--sidebar-border)",
    // Soft product --ring via --list-focus-ring; both slots same token so
    // selected+focused never falls back to trees accent/primary outline.
    "--trees-focus-ring-color-override": "var(--list-focus-ring)",
    "--trees-selected-focused-border-color-override": "var(--list-focus-ring)",
    "--trees-accent-override": "var(--primary)",
    "--trees-selected-bg-override": "var(--list-active-bg)",
    "--trees-selected-fg-override": "var(--sidebar-foreground)",
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
