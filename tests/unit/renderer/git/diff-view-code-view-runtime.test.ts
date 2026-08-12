import {
  codeViewLayoutFlushGenerationForTest,
  hardenCodeViewInstanceChanged,
  scheduleCodeViewLayoutFlush,
} from "@pier/ui/diff-view/code-view-runtime.ts";
import { describe, expect, it, vi } from "vitest";

describe("hardenCodeViewInstanceChanged", () => {
  it("swallows stale instanceChanged when instance left instanceToItem", () => {
    const instanceToItem = new Map<unknown, unknown>();
    const live = { id: "live" };
    const stale = { id: "stale" };
    instanceToItem.set(live, { id: "live" });

    const original = vi.fn((instance: unknown, _layoutDirty: boolean): void => {
      if (!instanceToItem.has(instance)) {
        throw new Error(
          "CodeView.instanceChanged: An instance has changed that is not registered"
        );
      }
    });

    const viewer = {
      instanceChanged: original as (
        instance: unknown,
        layoutDirty: boolean
      ) => void,
      instanceToItem,
      render: vi.fn(),
    };

    hardenCodeViewInstanceChanged(viewer);
    expect(() => viewer.instanceChanged(stale, false)).not.toThrow();
    expect(original).not.toHaveBeenCalled();

    expect(() => viewer.instanceChanged(live, true)).not.toThrow();
    expect(original).toHaveBeenCalledWith(live, true);
  });

  it("swallows thrown stale-registration errors even without a map", () => {
    const original = vi.fn(
      (_instance: unknown, _layoutDirty: boolean): void => {
        throw new Error(
          "CodeView.instanceChanged: An instance has changed that is not registered"
        );
      }
    );
    const viewer = {
      instanceChanged: original as (
        instance: unknown,
        layoutDirty: boolean
      ) => void,
      render: vi.fn(),
    };
    hardenCodeViewInstanceChanged(viewer);
    expect(() => viewer.instanceChanged({}, false)).not.toThrow();
  });

  it("rethrows unrelated instanceChanged failures", () => {
    const original = vi.fn(
      (_instance: unknown, _layoutDirty: boolean): void => {
        throw new Error("boom unrelated");
      }
    );
    const viewer = {
      instanceChanged: original as (
        instance: unknown,
        layoutDirty: boolean
      ) => void,
      render: vi.fn(),
    };
    hardenCodeViewInstanceChanged(viewer);
    expect(() => viewer.instanceChanged({}, false)).toThrow("boom unrelated");
  });
});

describe("scheduleCodeViewLayoutFlush", () => {
  it("only the latest scheduled generation flushes render", async () => {
    const render = vi.fn();
    const viewer = {
      getContainerElement: () => document.createElement("div"),
      instanceChanged: vi.fn(),
      render,
    };

    scheduleCodeViewLayoutFlush(viewer, 2);
    expect(codeViewLayoutFlushGenerationForTest(viewer)).toBe(1);
    scheduleCodeViewLayoutFlush(viewer, 2);
    expect(codeViewLayoutFlushGenerationForTest(viewer)).toBe(2);

    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenNthCalledWith(1, true);
    expect(render).toHaveBeenNthCalledWith(2, true);
  });

  it("skips flush when CodeView container is already gone", async () => {
    const render = vi.fn();
    const viewer = {
      getContainerElement: () => undefined,
      instanceChanged: vi.fn(),
      render,
    };
    scheduleCodeViewLayoutFlush(viewer, 2);
    await Promise.resolve();
    expect(render).not.toHaveBeenCalled();
  });

  it("repairs stickyOffset ≫ paged scrollTop after flush and re-renders once", async () => {
    const stickyOffset = document.createElement("div");
    stickyOffset.style.height = "5000px";
    const root = document.createElement("div");
    Object.defineProperty(root, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });
    const renderState = {
      stickyBottom: 5800,
      stickyHeight: 800,
      stickyTop: 5000,
    };
    const render = vi.fn();
    const viewer = {
      getContainerElement: () => root,
      // Logical would be wrong if preferred; resync must use paged root.
      getScrollTop: () => 2_000_000,
      instanceChanged: vi.fn(),
      render,
      renderState,
      root,
      stickyOffset,
      updateStickyPositioning: vi.fn(),
    };

    scheduleCodeViewLayoutFlush(viewer, 2);
    await Promise.resolve();
    // 2 flush passes + 1 repair pass
    expect(render).toHaveBeenCalledTimes(3);
    expect(stickyOffset.style.height).toBe("0px");
    expect(renderState.stickyBottom).toBe(-1);
    expect(renderState.stickyHeight).toBe(0);
  });
});
