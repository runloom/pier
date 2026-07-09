import type * as React from "react";

export type PierFileTreeStyle = React.CSSProperties & {
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
  "--trees-scrollbar-gutter-override"?: string;
  "--trees-scrollbar-thumb-override"?: string;
  "--trees-search-bg-override"?: string;
  "--trees-search-fg-override"?: string;
  "--trees-selected-bg-override"?: string;
  "--trees-selected-fg-override"?: string;
};

export function pierFileTreeStyle(
  style: React.CSSProperties | undefined
): PierFileTreeStyle {
  return {
    "--trees-bg-override": "var(--sidebar)",
    "--trees-fg-override": "var(--sidebar-foreground)",
    "--trees-fg-muted-override": "var(--muted-foreground)",
    "--trees-bg-muted-override": "var(--interactive-hover)",
    "--trees-input-bg-override": "var(--muted)",
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
