import type { GitGutterKind } from "../../editor/git-markers.ts";

/**
 * Dedicated left column for preview git bars (same 6px as the source
 * `.cm-git-gutter`). Always reserved for disk previews so the column does not
 * jump when a patch arrives. Comment icons stay in the inner
 * `MARKDOWN_PREVIEW_SCROLL_PAD_LEFT_PX` next to the prose.
 */
export const MARKDOWN_GIT_BAR_SLOT_PX = 6;

/** Visual stroke; hover thickens to 5px like the source gutter. */
export const MARKDOWN_GIT_BAR_WIDTH_PX = 3;
export const MARKDOWN_GIT_BAR_HOVER_WIDTH_PX = 5;
export const MARKDOWN_GIT_BAR_MIN_HEIGHT_PX = 3;

export const MARKDOWN_GIT_BAR_COLOR_VARS: Record<GitGutterKind, string> = {
  added: "--diff-addition-fg",
  deleted: "--diff-deletion-fg",
  modified: "--diff-modification-fg",
};

const PAINT_ORDER: Record<GitGutterKind, number> = {
  added: 1,
  deleted: 0,
  modified: 2,
};

export function markdownGitBarPaintOrder(kind: GitGutterKind): number {
  return PAINT_ORDER[kind];
}
