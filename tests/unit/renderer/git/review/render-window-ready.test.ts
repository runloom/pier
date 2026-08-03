import { describe, expect, it } from "vitest";
import { isReviewRenderWindowFirstPaintReady } from "../../../../../src/plugins/builtin/git/renderer/hooks/use-render-window-ready.ts";

describe("isReviewRenderWindowFirstPaintReady", () => {
  it("unlocks first paint when any item is visible even if still estimate", () => {
    // 冷开可见项全是 estimate：旧逻辑会死锁整页「正在加载变更」
    expect(
      isReviewRenderWindowFirstPaintReady({
        bufferedItemIds: [],
        collapsedItemIds: [],
        estimatedItemIds: ["section:a", "section:b"],
        visibleItemIds: ["section:a", "section:b"],
      })
    ).toBe(true);
  });

  it("stays locked with an empty window", () => {
    expect(
      isReviewRenderWindowFirstPaintReady({
        bufferedItemIds: ["section:a"],
        collapsedItemIds: [],
        estimatedItemIds: [],
        visibleItemIds: [],
      })
    ).toBe(false);
  });

  it("unlocks when visible items are already loaded", () => {
    expect(
      isReviewRenderWindowFirstPaintReady({
        bufferedItemIds: [],
        collapsedItemIds: [],
        estimatedItemIds: [],
        visibleItemIds: ["section:a"],
      })
    ).toBe(true);
  });
});
