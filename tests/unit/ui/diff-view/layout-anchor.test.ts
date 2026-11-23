import {
  captureDiffVirtualLayoutAnchor,
  diffViewItemViewportOffset,
  seedPendingDiffLayoutAnchor,
} from "@pier/ui/diff-view/item-anchor.ts";
import { describe, expect, it } from "vitest";

function viewer(items: Array<{ id: string; top: number }>, scrollTop: number) {
  return {
    getHeight: () => 600,
    getLayout: () => ({ gap: 1, paddingTop: 8 }),
    getScrollTop: () => scrollTop,
    items: items.map(({ id, top }) => ({
      height: 100,
      instance: { height: 100, top },
      item: { id },
      top,
      type: "diff",
    })),
    pendingLayoutAnchor: undefined as unknown,
    pendingScrollTarget: undefined as unknown,
    scrollAnimation: undefined as unknown,
  };
}

describe("captureDiffVirtualLayoutAnchor", () => {
  it("picks the last item whose top is at or above the viewport", () => {
    expect(
      captureDiffVirtualLayoutAnchor(
        viewer(
          [
            { id: "a", top: 0 },
            { id: "b", top: 101 },
            { id: "c", top: 202 },
          ],
          150
        )
      )
    ).toEqual({ id: "b", viewportOffset: 8 + 101 - 150 });
  });

  it("falls back to the first item when the viewport is above it", () => {
    expect(
      captureDiffVirtualLayoutAnchor(
        viewer(
          [
            { id: "a", top: 0 },
            { id: "b", top: 101 },
          ],
          -20
        )
      )
    ).toEqual({ id: "a", viewportOffset: 28 });
  });

  it("returns null without a measurable viewport", () => {
    const source = viewer([{ id: "a", top: 0 }], 0);
    source.getHeight = () => 0;
    expect(captureDiffVirtualLayoutAnchor(source)).toBeNull();
    expect(captureDiffVirtualLayoutAnchor(null)).toBeNull();
  });
});

describe("diffViewItemViewportOffset", () => {
  it("returns the item offset from the logical viewport top", () => {
    expect(diffViewItemViewportOffset(120, 40)).toBe(80);
    expect(diffViewItemViewportOffset(8, 0)).toBe(8);
  });

  it("returns null for missing or non-finite geometry", () => {
    expect(diffViewItemViewportOffset(undefined, 0)).toBeNull();
    expect(diffViewItemViewportOffset(0, undefined)).toBeNull();
    expect(diffViewItemViewportOffset(Number.NaN, 0)).toBeNull();
    expect(diffViewItemViewportOffset(0, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("seedPendingDiffLayoutAnchor", () => {
  it("writes an item anchor without touching scrollTop", () => {
    const source = viewer([{ id: "a", top: 0 }], 40);
    let writtenScrollTop = 0;
    Object.defineProperty(source, "scrollTop", {
      get: () => writtenScrollTop,
      set: (value: number) => {
        writtenScrollTop = value;
      },
    });
    expect(
      seedPendingDiffLayoutAnchor(source, {
        id: "a",
        viewportOffset: 12,
      })
    ).toBe(true);
    expect(source.pendingLayoutAnchor).toEqual({
      id: "a",
      type: "item",
      viewportOffset: 12,
    });
    expect(writtenScrollTop).toBe(0);
  });

  it("does not overwrite a pending target, animation, or anchor", () => {
    for (const key of [
      "pendingLayoutAnchor",
      "pendingScrollTarget",
      "scrollAnimation",
    ] as const) {
      const source = viewer([{ id: "a", top: 0 }], 0);
      source[key] = { id: "existing" };
      expect(
        seedPendingDiffLayoutAnchor(source, {
          id: "a",
          viewportOffset: 1,
        })
      ).toBe(false);
      expect(source[key]).toEqual({ id: "existing" });
    }
  });

  it("returns false for a zero-height or anchorless viewport", () => {
    const source = viewer([{ id: "a", top: 0 }], 0);
    source.getHeight = () => 0;
    expect(
      seedPendingDiffLayoutAnchor(source, { id: "a", viewportOffset: 1 })
    ).toBe(false);
    expect(
      seedPendingDiffLayoutAnchor(null, { id: "a", viewportOffset: 1 })
    ).toBe(false);
    expect(seedPendingDiffLayoutAnchor(viewer([], 0), null)).toBe(false);
  });
});
