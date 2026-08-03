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
});
