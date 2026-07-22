import type { MarkdownMeasureMode } from "./markdown-preview-preferences.ts";

/** Outline rail width (px). Single source for layout math + TOC width style. */
export const MARKDOWN_TOC_RAIL_WIDTH_PX = 224;

/** Gap between prose and outline when docked (`gap-4`). */
export const MARKDOWN_TOC_DOCK_GAP_PX = 16;

/**
 * Fallback measure in `ch` for dock *availability* math only.
 * Visible measure is CSS `--md-measure` on `[data-slot="markdown-prose"]`.
 */
export const MARKDOWN_COMFORTABLE_MEASURE_CH = 72;

/** Shared top inset for dock + overlay outline chrome (`sticky` / padding). */
export const MARKDOWN_TOC_INSET_PX = 8;

/**
 * Preview frame edge inset shared by the floating outline and font-scale control
 * (`right-3` / `bottom-3` = 12px). Overlay outline right-aligns to this edge.
 */
export const MARKDOWN_PREVIEW_EDGE_INSET_PX = 12;

/** Horizontal padding on the markdown scrollport (`px-6` = 24px). */
export const MARKDOWN_PREVIEW_SCROLL_PAD_X_PX = 24;

/**
 * Vertical reserve below the outline within the content area (zoom chrome, etc.).
 * Max outline height = contentAreaHeight - this value.
 */
export const MARKDOWN_TOC_MAX_HEIGHT_RESERVE_PX = 200;

/**
 * Shared outline max-height for every placement:
 * `content area height - MARKDOWN_TOC_MAX_HEIGHT_RESERVE_PX`.
 */
export function markdownOutlineFrameHeightPx(
  contentAreaHeightPx: number
): number {
  return Math.max(0, contentAreaHeightPx - MARKDOWN_TOC_MAX_HEIGHT_RESERVE_PX);
}

export type MarkdownTocPlacement = "dock" | "overlay";

/**
 * Dock when comfortable reading is on and
 * `contentWidth + outline + gap <= available`.
 */
export function canDockMarkdownOutline(params: {
  availableWidthPx: number;
  contentWidthPx: number;
  hasHeadings: boolean;
  measureMode: MarkdownMeasureMode;
}): boolean {
  if (params.measureMode !== "comfortable" || !params.hasHeadings) {
    return false;
  }
  if (!(params.availableWidthPx > 0 && params.contentWidthPx > 0)) {
    return false;
  }
  return (
    params.availableWidthPx >=
    params.contentWidthPx +
      MARKDOWN_TOC_RAIL_WIDTH_PX +
      MARKDOWN_TOC_DOCK_GAP_PX
  );
}

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
 * Article column width for dock checks. Cap by CSS max-width so a stretched
 * flex item cannot inflate the measure and flip back to overlay.
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
