import {
  canDockMarkdownOutline,
  MARKDOWN_TOC_DOCK_GAP_PX,
  MARKDOWN_TOC_MAX_HEIGHT_RESERVE_PX,
  MARKDOWN_TOC_RAIL_WIDTH_PX,
  markdownOutlineFrameHeightPx,
  readMarkdownContentWidthPx,
} from "@plugins/builtin/files/renderer/markdown-preview-toc-layout.ts";
import { describe, expect, it } from "vitest";

describe("canDockMarkdownOutline", () => {
  const contentWidthPx = 560;
  const needed =
    contentWidthPx + MARKDOWN_TOC_RAIL_WIDTH_PX + MARKDOWN_TOC_DOCK_GAP_PX;

  it("docks when comfortable reading fits content plus outline", () => {
    expect(
      canDockMarkdownOutline({
        availableWidthPx: needed,
        contentWidthPx,
        hasHeadings: true,
        measureMode: "comfortable",
      })
    ).toBe(true);
  });

  it("overlays when leftover space cannot fit the outline", () => {
    expect(
      canDockMarkdownOutline({
        availableWidthPx: needed - 1,
        contentWidthPx,
        hasHeadings: true,
        measureMode: "comfortable",
      })
    ).toBe(false);
  });

  it("never docks in wide reading mode", () => {
    expect(
      canDockMarkdownOutline({
        availableWidthPx: needed * 2,
        contentWidthPx,
        hasHeadings: true,
        measureMode: "wide",
      })
    ).toBe(false);
  });

  it("never docks without headings", () => {
    expect(
      canDockMarkdownOutline({
        availableWidthPx: needed * 2,
        contentWidthPx,
        hasHeadings: false,
        measureMode: "comfortable",
      })
    ).toBe(false);
  });
});

describe("readMarkdownContentWidthPx", () => {
  it("does not let a stretched box exceed the CSS max-width measure", () => {
    const prose = document.createElement("div");
    prose.style.maxWidth = "560px";
    document.body.appendChild(prose);
    Object.defineProperty(prose, "getBoundingClientRect", {
      value: () =>
        ({
          width: 1200,
          height: 0,
          top: 0,
          left: 0,
          bottom: 0,
          right: 0,
          x: 0,
          y: 0,
          toJSON: () => undefined,
        }) satisfies DOMRect,
    });
    expect(readMarkdownContentWidthPx(prose, 8)).toBe(560);
    prose.remove();
  });
});

describe("markdownOutlineFrameHeightPx", () => {
  it("caps outline to content area height minus the shared reserve", () => {
    expect(MARKDOWN_TOC_MAX_HEIGHT_RESERVE_PX).toBe(200);
    expect(markdownOutlineFrameHeightPx(800)).toBe(
      800 - MARKDOWN_TOC_MAX_HEIGHT_RESERVE_PX
    );
    expect(markdownOutlineFrameHeightPx(80)).toBe(0);
  });
});
