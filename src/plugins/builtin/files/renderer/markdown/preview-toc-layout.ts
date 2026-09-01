/** Expanded outline panel width (px). Hover panel lives inside this rail slot. */
export const MARKDOWN_TOC_PANEL_WIDTH_PX = 224;

/** Notion-style tick visual width budget (longest tick + hit padding). */
export const MARKDOWN_TOC_TICK_RAIL_WIDTH_PX = 20;

/** Tick stroke height (px). */
export const MARKDOWN_TOC_TICK_HEIGHT_PX = 2;

/** Vertical gap between ticks (px). */
export const MARKDOWN_TOC_TICK_GAP_PX = 6;

/** Longest tick width for depth-1 headings (px). */
export const MARKDOWN_TOC_TICK_WIDTH_MAX_PX = 16;

/** Shortest tick width for deep headings (px). */
export const MARKDOWN_TOC_TICK_WIDTH_MIN_PX = 8;

/** Per-depth step when shrinking ticks (px). */
export const MARKDOWN_TOC_TICK_WIDTH_STEP_PX = 4;

/**
 * Comfortable column in root rem. Must match CSS `--md-measure-comfortable`.
 * Visible measure is CSS `--md-measure` on `[data-slot="markdown-prose"]`.
 */
export const MARKDOWN_COMFORTABLE_MEASURE_REM = 42;

/**
 * Preview-frame top inset for scroll padding / legacy chrome.
 * Outline rail uses `MARKDOWN_TOC_TOP_RATIO` instead (center-upper).
 */
export const MARKDOWN_TOC_INSET_PX = 8;

/**
 * Vertical placement of the outline rail as a fraction of the preview frame
 * height (center-upper, not pinned to the top edge).
 */
export const MARKDOWN_TOC_TOP_RATIO = 0.22;

/**
 * Preview frame edge inset matching the shared zoom pill (`px-3` = 12px).
 */
export const MARKDOWN_PREVIEW_EDGE_INSET_PX = 12;

/**
 * Trailing blank between the outline card/ticks and the preview frame edge.
 * The rail is flush-right; this width is a hover bridge so moving into the
 * blank does not dismiss the panel, while ticks/card stay visually inset.
 */
export const MARKDOWN_TOC_EDGE_INSET_PX = 28;

/**
 * Bottom reserve inside the preview frame so the hover panel clears zoom chrome.
 */
export const MARKDOWN_TOC_BOTTOM_RESERVE_PX = 56;

/**
 * Default horizontal padding on the markdown scrollport (right when no outline).
 * Kept for TOC geometry helpers that only need a symmetric edge reserve.
 */
export const MARKDOWN_PREVIEW_SCROLL_PAD_X_PX = 24;

/**
 * Left padding of the markdown scrollport.
 * Slightly wider than the right pad (24) so the comment gutter icon sits
 * outside prose without feeling cramped against the panel edge.
 */
export const MARKDOWN_PREVIEW_SCROLL_PAD_LEFT_PX = 28;

/**
 * Extra gap between prose and the tick rail (beyond edge inset + tick width).
 */
export const MARKDOWN_TOC_CONTENT_GAP_PX = 12;

/**
 * Right inset for the scrollport when the outline tick rail is present, so wide
 * reading (`--md-measure: 100%`) does not run under the ticks.
 */
export const MARKDOWN_TOC_CONTENT_INSET_PX =
  MARKDOWN_TOC_EDGE_INSET_PX +
  MARKDOWN_TOC_TICK_RAIL_WIDTH_PX +
  MARKDOWN_TOC_CONTENT_GAP_PX;

/**
 * Hover-panel max height that keeps a vertically-centered card inside the
 * preview frame. The rail sits at `MARKDOWN_TOC_TOP_RATIO`; the panel is
 * centered on the tick stack, so height is limited by the smaller of the
 * space above and below that anchor.
 */
export function markdownOutlineHoverMaxHeightPx(frameHeightPx: number): number {
  if (!(frameHeightPx > 0)) return 0;
  const topOffsetPx = frameHeightPx * MARKDOWN_TOC_TOP_RATIO;
  const abovePx = Math.max(0, topOffsetPx - MARKDOWN_TOC_EDGE_INSET_PX);
  const belowPx = Math.max(
    0,
    frameHeightPx - topOffsetPx - MARKDOWN_TOC_BOTTOM_RESERVE_PX
  );
  return Math.max(0, Math.floor(2 * Math.min(abovePx, belowPx)));
}

/** Notion-style tick width by heading depth (h1 longest). */
export function markdownTocTickWidthPx(depth: number): number {
  const level = Number.isFinite(depth) ? Math.max(1, Math.floor(depth)) : 1;
  return Math.max(
    MARKDOWN_TOC_TICK_WIDTH_MIN_PX,
    MARKDOWN_TOC_TICK_WIDTH_MAX_PX -
      (level - 1) * MARKDOWN_TOC_TICK_WIDTH_STEP_PX
  );
}

/**
 * Hover panel width clamped so the rail slot never extends past the frame.
 * Prefers the full panel width when the frame is wide enough.
 */
export function markdownOutlineHoverWidthPx(frameWidthPx: number): number {
  if (!(frameWidthPx > 0)) return MARKDOWN_TOC_PANEL_WIDTH_PX;
  const available = Math.max(
    0,
    frameWidthPx - MARKDOWN_TOC_EDGE_INSET_PX - MARKDOWN_PREVIEW_SCROLL_PAD_X_PX
  );
  return Math.max(
    MARKDOWN_TOC_TICK_RAIL_WIDTH_PX,
    Math.min(MARKDOWN_TOC_PANEL_WIDTH_PX, available)
  );
}

export type MarkdownTocPlacement = "overlay";

export function readScrollContentWidthPx(scrollRoot: HTMLElement): number {
  const styles = getComputedStyle(scrollRoot);
  const padX =
    (Number.parseFloat(styles.paddingLeft) || 0) +
    (Number.parseFloat(styles.paddingRight) || 0);
  return Math.max(0, scrollRoot.clientWidth - padX);
}
