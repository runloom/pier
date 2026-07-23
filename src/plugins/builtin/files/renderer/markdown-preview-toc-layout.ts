/** Expanded outline panel width (px). Hover panel lives inside this rail slot. */
export const MARKDOWN_TOC_PANEL_WIDTH_PX = 224;

/** @deprecated Alias for expanded panel width (historical rail name). */
export const MARKDOWN_TOC_RAIL_WIDTH_PX = MARKDOWN_TOC_PANEL_WIDTH_PX;

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
 * Fallback measure in `ch` for width helpers only.
 * Visible measure is CSS `--md-measure` on `[data-slot="markdown-prose"]`.
 */
export const MARKDOWN_COMFORTABLE_MEASURE_CH = 85;

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
 * Preview frame edge inset for font-scale control (`right-3` / `bottom-3` = 12px).
 */
export const MARKDOWN_PREVIEW_EDGE_INSET_PX = 12;

/**
 * Outline rail inset from the right edge — looser than the zoom control so the
 * tick rail is not flush against the frame.
 */
export const MARKDOWN_TOC_EDGE_INSET_PX = 28;

/**
 * Bottom reserve inside the preview frame so the hover panel clears zoom chrome.
 */
export const MARKDOWN_TOC_BOTTOM_RESERVE_PX = 56;

/** Horizontal padding on the markdown scrollport (`px-6` = 24px). */
export const MARKDOWN_PREVIEW_SCROLL_PAD_X_PX = 24;

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

/** @deprecated Prefer `markdownOutlineHoverMaxHeightPx` for the Notion rail. */
export function markdownOutlineFrameHeightPx(
  contentAreaHeightPx: number
): number {
  return markdownOutlineHoverMaxHeightPx(contentAreaHeightPx);
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

function measureMarkdownChWidthPx(prose: HTMLElement): number {
  const span = document.createElement("span");
  span.textContent = "0";
  span.setAttribute("aria-hidden", "true");
  const font = getComputedStyle(prose).font;
  span.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;white-space:nowrap";
  if (font) {
    span.style.font = font;
  }
  prose.appendChild(span);
  const width = span.getBoundingClientRect().width;
  span.remove();
  if (width > 0) return width;
  const fontSize = Number.parseFloat(getComputedStyle(prose).fontSize);
  return Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 0.5 : 6.5;
}

/**
 * Article column width helper. Cap by CSS max-width so a stretched box cannot
 * inflate the measure.
 */
export function readMarkdownContentWidthPx(
  prose: HTMLElement | null,
  fallbackChWidthPx?: number
): number {
  const chWidth =
    fallbackChWidthPx ?? (prose ? measureMarkdownChWidthPx(prose) : 6.5);
  const fallback = MARKDOWN_COMFORTABLE_MEASURE_CH * chWidth;
  if (!prose) {
    return fallback;
  }
  const laidOut = prose.getBoundingClientRect().width;
  const maxWidth = getComputedStyle(prose).maxWidth;
  if (maxWidth.endsWith("px")) {
    const maxPx = Number.parseFloat(maxWidth);
    if (Number.isFinite(maxPx) && maxPx > 0) {
      if (laidOut > 0) {
        return Math.min(laidOut, maxPx);
      }
      return maxPx;
    }
  }
  if (laidOut > 0) {
    return laidOut;
  }
  return fallback;
}
