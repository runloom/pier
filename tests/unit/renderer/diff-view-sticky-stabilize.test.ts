import {
  DIFF_HEADER_HEIGHT_PX,
  diffFontMetrics,
} from "@pier/ui/diff-view-appearance.ts";
import { stabilizeCodeViewStickyPositioning } from "@pier/ui/diff-view-sticky-stabilize.ts";
import { describe, expect, it, vi } from "vitest";

describe("diff header metrics", () => {
  it("uses the compact 32px multi-diff header chrome height", () => {
    expect(DIFF_HEADER_HEIGHT_PX).toBe(32);
    expect(diffFontMetrics("16px").diffHeaderHeight).toBe(32);
    expect(diffFontMetrics("16px").lineHeight).toBeCloseTo(22.75);
  });
});

describe("stabilizeCodeViewStickyPositioning", () => {
  it("replaces random sticky top with a deterministic flush", () => {
    const stickyContainer = document.createElement("div");
    const stickyOffset = document.createElement("div");
    const original = vi.fn();
    const viewer = {
      applyStickyPositioning: original,
      getHeight: () => 400,
      itemMetricsCache: { diffHeaderHeight: 32 },
      renderState: { stickyBottom: 200, stickyHeight: 150, stickyTop: 50 },
      stickyContainer,
      stickyOffset,
    };

    stabilizeCodeViewStickyPositioning(viewer);
    expect(viewer.applyStickyPositioning).not.toBe(original);

    // height 400 - sticky span 150 => top 250; bottom 250 + header 32
    expect(stickyOffset.style.height).toBe("50px");
    expect(stickyContainer.style.top).toBe("250px");
    expect(stickyContainer.style.bottom).toBe("282px");
    expect(viewer.renderState).toMatchObject({
      stickyBottom: 200,
      stickyHeight: 150,
      stickyTop: 50,
    });

    // Second call keeps the patched apply and re-flushes current bounds.
    const patched = viewer.applyStickyPositioning;
    stabilizeCodeViewStickyPositioning(viewer);
    expect(viewer.applyStickyPositioning).toBe(patched);
    expect(stickyContainer.style.top).toBe("250px");
  });

  it("patches without applying when sticky bounds are unset", () => {
    const stickyContainer = document.createElement("div");
    const stickyOffset = document.createElement("div");
    const original = vi.fn();
    const viewer = {
      applyStickyPositioning: original,
      getHeight: () => 400,
      itemMetricsCache: { diffHeaderHeight: 32 },
      renderState: { stickyBottom: -1, stickyHeight: 0, stickyTop: -1 },
      stickyContainer,
      stickyOffset,
    };

    stabilizeCodeViewStickyPositioning(viewer);
    expect(viewer.applyStickyPositioning).not.toBe(original);
    expect(stickyOffset.style.height).toBe("");
    expect(stickyContainer.style.top).toBe("");
  });
});
