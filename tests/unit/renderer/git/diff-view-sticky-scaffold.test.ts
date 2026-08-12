import { resyncDiffStickyScaffolding } from "@pier/ui/diff-view/code-view-runtime.ts";
import { describe, expect, it, vi } from "vitest";

function makeRoot(scrollTop: number): HTMLElement {
  const root = document.createElement("div");
  Object.defineProperty(root, "scrollTop", {
    configurable: true,
    value: scrollTop,
    writable: true,
  });
  return root;
}

describe("resyncDiffStickyScaffolding", () => {
  it("no-ops when stickyOffset is aligned with paged scrollTop", () => {
    const stickyOffset = document.createElement("div");
    stickyOffset.style.height = "5000px";
    const updateStickyPositioning = vi.fn();
    const view = {
      root: makeRoot(5000),
      renderState: { stickyBottom: 5800, stickyHeight: 800, stickyTop: 5000 },
      stickyOffset,
      updateStickyPositioning,
    };

    expect(resyncDiffStickyScaffolding(view)).toBe(false);
    expect(updateStickyPositioning).not.toHaveBeenCalled();
    expect(stickyOffset.style.height).toBe("5000px");
  });

  it("repairs stickyOffset ≫ paged scrollTop after content remeasure", () => {
    const stickyOffset = document.createElement("div");
    stickyOffset.style.height = "5000px";
    const renderState = {
      stickyBottom: 5800,
      stickyHeight: 800,
      stickyTop: 5000,
    };
    const updateStickyPositioning = vi.fn(function updateSticky(this: {
      renderState: typeof renderState;
      stickyOffset: HTMLElement;
    }) {
      // Official path still cannot resolve bounds — leave spacer until hard clamp.
      this.renderState.stickyTop = -1;
    });
    const view = {
      root: makeRoot(0),
      renderState,
      stickyOffset,
      updateStickyPositioning: updateStickyPositioning.bind({
        renderState,
        stickyOffset,
      }),
    };

    expect(resyncDiffStickyScaffolding(view)).toBe(true);
    expect(updateStickyPositioning).toHaveBeenCalledTimes(1);
    expect(stickyOffset.style.height).toBe("0px");
    expect(renderState.stickyTop).toBe(0);
    // Half-updated tuple must stay invalidated for callers without follow-up render.
    expect(renderState.stickyBottom).toBe(-1);
    expect(renderState.stickyHeight).toBe(0);
  });

  it("compares against paged root.scrollTop, not logical getScrollTop", () => {
    const stickyOffset = document.createElement("div");
    // Aligned with paged root (100), not with logical 2_100_100.
    stickyOffset.style.height = "100px";
    const view = {
      getScrollTop: () => 2_100_100,
      root: makeRoot(100),
      renderState: { stickyBottom: 900, stickyHeight: 800, stickyTop: 100 },
      stickyOffset,
      updateStickyPositioning: vi.fn(),
    };

    expect(resyncDiffStickyScaffolding(view)).toBe(false);
    expect(view.updateStickyPositioning).not.toHaveBeenCalled();
  });

  it("detects desync using paged root when logical getScrollTop is huge", () => {
    const stickyOffset = document.createElement("div");
    stickyOffset.style.height = "5000px";
    const renderState = {
      stickyBottom: 5800,
      stickyHeight: 800,
      stickyTop: 5000,
    };
    const view = {
      getScrollTop: () => 2_000_000,
      root: makeRoot(0),
      renderState,
      stickyOffset,
      updateStickyPositioning: vi.fn(),
    };

    expect(resyncDiffStickyScaffolding(view)).toBe(true);
    expect(stickyOffset.style.height).toBe("0px");
    expect(renderState.stickyTop).toBe(0);
    expect(renderState.stickyBottom).toBe(-1);
    expect(renderState.stickyHeight).toBe(0);
  });

  it("accepts official updateStickyPositioning when it realigns the spacer", () => {
    const stickyOffset = document.createElement("div");
    stickyOffset.style.height = "5000px";
    const renderState = {
      stickyBottom: 5800,
      stickyHeight: 800,
      stickyTop: 5000,
    };
    const updateStickyPositioning = vi.fn(() => {
      stickyOffset.style.height = "0px";
      renderState.stickyTop = 0;
      renderState.stickyBottom = 800;
      renderState.stickyHeight = 800;
    });
    const view = {
      root: makeRoot(0),
      renderState,
      stickyOffset,
      updateStickyPositioning,
    };

    expect(resyncDiffStickyScaffolding(view)).toBe(true);
    expect(updateStickyPositioning).toHaveBeenCalledTimes(1);
    expect(stickyOffset.style.height).toBe("0px");
    expect(renderState.stickyTop).toBe(0);
  });

  it("allows a small header slop without treating it as desync", () => {
    const stickyOffset = document.createElement("div");
    stickyOffset.style.height = "40px";
    const view = {
      root: makeRoot(0),
      renderState: { stickyBottom: 800, stickyHeight: 800, stickyTop: 40 },
      stickyOffset,
      updateStickyPositioning: vi.fn(),
    };

    expect(resyncDiffStickyScaffolding(view)).toBe(false);
    expect(view.updateStickyPositioning).not.toHaveBeenCalled();
  });

  it("falls back to getScrollTop when root is absent (test doubles)", () => {
    const stickyOffset = document.createElement("div");
    stickyOffset.style.height = "5000px";
    const renderState = {
      stickyBottom: 5800,
      stickyHeight: 800,
      stickyTop: 5000,
    };
    const view = {
      getScrollTop: () => 0,
      renderState,
      stickyOffset,
      updateStickyPositioning: vi.fn(),
    };

    expect(resyncDiffStickyScaffolding(view)).toBe(true);
    expect(stickyOffset.style.height).toBe("0px");
  });
});
