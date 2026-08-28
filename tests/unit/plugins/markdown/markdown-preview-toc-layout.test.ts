import {
  MARKDOWN_PREVIEW_SCROLL_PAD_X_PX,
  MARKDOWN_TOC_BOTTOM_RESERVE_PX,
  MARKDOWN_TOC_CONTENT_INSET_PX,
  MARKDOWN_TOC_EDGE_INSET_PX,
  MARKDOWN_TOC_PANEL_WIDTH_PX,
  MARKDOWN_TOC_TICK_WIDTH_MAX_PX,
  MARKDOWN_TOC_TICK_WIDTH_MIN_PX,
  MARKDOWN_TOC_TOP_RATIO,
  markdownOutlineHoverMaxHeightPx,
  markdownOutlineHoverWidthPx,
  markdownTocTickWidthPx,
} from "@plugins/builtin/files/renderer/markdown/preview-toc-layout.ts";
import { describe, expect, it } from "vitest";

describe("markdownTocTickWidthPx", () => {
  it("uses longer ticks for shallower headings", () => {
    expect(markdownTocTickWidthPx(1)).toBe(MARKDOWN_TOC_TICK_WIDTH_MAX_PX);
    expect(markdownTocTickWidthPx(2)).toBe(12);
    expect(markdownTocTickWidthPx(3)).toBe(MARKDOWN_TOC_TICK_WIDTH_MIN_PX);
    expect(markdownTocTickWidthPx(6)).toBe(MARKDOWN_TOC_TICK_WIDTH_MIN_PX);
  });
});

describe("markdownOutlineHoverMaxHeightPx", () => {
  it("limits height so a centered panel fits above and below the rail", () => {
    const frameHeight = 800;
    const topOffset = frameHeight * MARKDOWN_TOC_TOP_RATIO;
    const above = topOffset - MARKDOWN_TOC_EDGE_INSET_PX;
    const below = frameHeight - topOffset - MARKDOWN_TOC_BOTTOM_RESERVE_PX;
    expect(markdownOutlineHoverMaxHeightPx(frameHeight)).toBe(
      Math.floor(2 * Math.min(above, below))
    );
    expect(markdownOutlineHoverMaxHeightPx(40)).toBe(0);
  });
});

describe("markdownOutlineHoverWidthPx", () => {
  it("prefers the full panel width when the frame is wide enough", () => {
    expect(markdownOutlineHoverWidthPx(900)).toBe(MARKDOWN_TOC_PANEL_WIDTH_PX);
  });

  it("clamps when the preview frame is narrow", () => {
    expect(markdownOutlineHoverWidthPx(200)).toBeLessThan(
      MARKDOWN_TOC_PANEL_WIDTH_PX
    );
    expect(markdownOutlineHoverWidthPx(200)).toBeGreaterThan(0);
  });
});

describe("MARKDOWN_TOC_CONTENT_INSET_PX", () => {
  it("reserves more right space than the default scroll pad", () => {
    expect(MARKDOWN_TOC_CONTENT_INSET_PX).toBeGreaterThan(
      MARKDOWN_PREVIEW_SCROLL_PAD_X_PX
    );
  });
});
