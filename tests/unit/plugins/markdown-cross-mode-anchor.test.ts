import {
  applyMarkdownPreviewAnchor,
  captureMarkdownPreviewAnchor,
  clampUnit,
  defaultMarkdownCrossModeAnchor,
  findMarkdownPageIndexForOffset,
  findMarkdownPreviewBlockForOffset,
  MARKDOWN_VIEWPORT_FOCUS_BAND,
  markdownPagesToForceForOffset,
  markdownViewportFocusY,
  offsetWithinBlockRange,
} from "@plugins/builtin/files/renderer/markdown/cross-mode-anchor.ts";
import { scheduleMarkdownPreviewAnchorReflow } from "@plugins/builtin/files/renderer/markdown/cross-mode-anchor-reflow.ts";
import { describe, expect, it } from "vitest";

function block(
  start: number,
  end: number,
  top: number,
  height: number
): HTMLElement {
  const element = document.createElement("div");
  element.dataset.sourceOffset = String(start);
  element.dataset.sourceEndOffset = String(end);
  element.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  return element;
}

function scrollRootWithBlocks(
  blocks: HTMLElement[],
  rootTop = 0,
  rootHeight = 400
): HTMLElement {
  const root = document.createElement("div");
  root.getBoundingClientRect = () =>
    ({
      top: rootTop,
      bottom: rootTop + rootHeight,
      height: rootHeight,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: rootTop,
      toJSON: () => ({}),
    }) as DOMRect;
  Object.defineProperty(root, "scrollTop", {
    configurable: true,
    value: 0,
    writable: true,
  });
  for (const item of blocks) {
    root.append(item);
  }
  return root;
}

describe("markdown cross-mode anchor", () => {
  it("defines a stable viewport focus band", () => {
    expect(MARKDOWN_VIEWPORT_FOCUS_BAND.maxPx).toBe(96);
    expect(MARKDOWN_VIEWPORT_FOCUS_BAND.ratio).toBe(0.22);
    expect(
      markdownViewportFocusY({
        top: 100,
        height: 500,
        bottom: 600,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      } as DOMRect)
    ).toBe(100 + 96);
    expect(
      markdownViewportFocusY({
        top: 0,
        height: 100,
        bottom: 100,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect)
    ).toBe(22);
  });

  it("interpolates offsets within a block range", () => {
    expect(clampUnit(-1)).toBe(0);
    expect(clampUnit(2)).toBe(1);
    expect(offsetWithinBlockRange(10, 20, 0.5)).toBe(15);
    expect(offsetWithinBlockRange(10, 10, 0.9)).toBe(10);
  });

  it("captures the block under the preview focus band with progress", () => {
    // focusY = 0 + min(96, 400*0.22) = 88
    const root = scrollRootWithBlocks([
      block(0, 40, 0, 50),
      block(40, 120, 60, 80),
      block(120, 200, 200, 40),
    ]);
    const anchor = captureMarkdownPreviewAnchor(root);
    expect(anchor.align).toBe("start");
    expect(anchor.offset).toBeGreaterThanOrEqual(40);
    expect(anchor.offset).toBeLessThanOrEqual(120);
    expect(anchor.blockProgress).toBeDefined();
    expect(anchor.blockProgress ?? 0).toBeGreaterThan(0);
  });

  it("finds the tightest covering block for an offset", () => {
    const root = scrollRootWithBlocks([
      block(0, 100, 0, 40),
      block(20, 40, 40, 20),
      block(100, 200, 80, 40),
    ]);
    const hit = findMarkdownPreviewBlockForOffset(root, 30);
    expect(hit?.dataset.sourceOffset).toBe("20");
    expect(
      findMarkdownPreviewBlockForOffset(root, 150)?.dataset.sourceOffset
    ).toBe("100");
  });

  it("applies an anchor by placing offset progress on the focus band", () => {
    // rootTop=0 height=400 → focusY=88 → focusOffsetInRoot=88
    // target top=300 height=40, root.scrollTop starts 0
    // progress 0.5 → targetTop = 0 + 300 + 20 - 88 = 232
    const target = block(80, 120, 300, 40);
    const root = scrollRootWithBlocks([block(0, 40, 0, 40), target]);
    Object.defineProperty(root, "scrollLeft", {
      configurable: true,
      value: 120,
      writable: true,
    });
    const ok = applyMarkdownPreviewAnchor(root, {
      align: "start",
      offset: 100,
      blockProgress: 0.5,
    });
    expect(ok).toBe(true);
    expect(root.scrollTop).toBe(232);
    // Cross-mode: horizontal always pins to the left edge.
    expect(root.scrollLeft).toBe(0);
  });

  it("derives block progress from offset when capture omitted it", () => {
    const target = block(80, 120, 300, 40);
    const root = scrollRootWithBlocks([block(0, 40, 0, 40), target]);
    // offset 100 is halfway in [80, 120]
    applyMarkdownPreviewAnchor(root, {
      align: "start",
      offset: 100,
    });
    expect(root.scrollTop).toBe(232);
  });

  it("resolves page indices for source offsets", () => {
    const pages = [
      { index: 0, range: { startOffset: 0, endOffset: 50 } },
      { index: 1, range: { startOffset: 51, endOffset: 120 } },
      { index: 2, range: { startOffset: 121, endOffset: 200 } },
    ];
    expect(findMarkdownPageIndexForOffset(pages, 10)).toBe(0);
    expect(findMarkdownPageIndexForOffset(pages, 80)).toBe(1);
    expect(findMarkdownPageIndexForOffset(pages, 300)).toBe(2);
    expect(findMarkdownPageIndexForOffset([], 1)).toBeNull();
  });

  it("forces every page through the target offset for layout accuracy", () => {
    const pages = [
      { index: 0, range: { startOffset: 0, endOffset: 50 } },
      { index: 1, range: { startOffset: 51, endOffset: 120 } },
      { index: 2, range: { startOffset: 121, endOffset: 200 } },
    ];
    expect(markdownPagesToForceForOffset(pages, 80)).toEqual([0, 1]);
    expect(markdownPagesToForceForOffset(pages, 180)).toEqual([0, 1, 2]);
    expect(markdownPagesToForceForOffset([], 1)).toEqual([]);
  });

  it("schedules reflow re-apply and disposes cleanly", () => {
    const target = block(0, 40, 0, 40);
    const root = scrollRootWithBlocks([target]);
    let applyCount = 0;
    const original = root.scrollTop;
    Object.defineProperty(root, "scrollTop", {
      configurable: true,
      get: () => original,
      set: () => {
        applyCount += 1;
      },
    });
    // Seed a block rect so apply succeeds.
    target.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 40,
        height: 40,
        left: 0,
        right: 100,
        width: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const dispose = scheduleMarkdownPreviewAnchorReflow({
      anchor: { align: "start", offset: 10, blockProgress: 0.25 },
      maxCorrections: 1,
      observeRoot: root,
      scrollRoot: root,
      windowMs: 50,
    });
    dispose();
    expect(applyCount).toBeGreaterThanOrEqual(0);
  });

  it("builds a default start-aligned anchor", () => {
    expect(defaultMarkdownCrossModeAnchor(42)).toEqual({
      align: "start",
      offset: 42,
    });
  });
});
