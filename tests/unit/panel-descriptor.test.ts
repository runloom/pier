import type { PanelContext } from "@shared/contracts/panel.ts";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";

const context: PanelContext = {
  contextId: "ctx-pier",
  cwd: "/Users/x/ABC/pier",
  openedPath: "/Users/x/ABC/pier",
  projectRootPath: "/Users/x/ABC/pier",
  source: "panel",
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/Users/x/ABC/pier",
};

describe("PanelDescriptor store", () => {
  beforeEach(() => {
    usePanelDescriptorStore.setState({ descriptors: {}, activeId: null });
  });

  it("stores shared display and context", () => {
    usePanelDescriptorStore.getState().upsert("p1", {
      context,
      display: {
        long: "/Users/x/ABC/pier",
        short: "pier",
      },
    });
    const d = usePanelDescriptorStore.getState().descriptors.p1;
    expect(d).toBeDefined();
    expect(d?.context).toEqual(context);
    expect(d?.display.long).toBe("/Users/x/ABC/pier");
    expect(d?.display.short).toBe("pier");
  });

  it("context is optional", () => {
    usePanelDescriptorStore.getState().upsert("p1", {
      display: { short: "Welcome" },
    });
    const d = usePanelDescriptorStore.getState().descriptors.p1;
    expect(d).toBeDefined();
    expect(d?.context).toBeUndefined();
  });
});

describe("usePanelDescriptor hook", () => {
  beforeEach(() => {
    usePanelDescriptorStore.setState({ descriptors: {}, activeId: null });
  });

  it("upserts shared descriptor and sets tab title to display.short", () => {
    const setTitle = vi.fn();
    const panel = { id: "term-1", setTitle };

    renderHook(() =>
      usePanelDescriptor(panel, {
        context,
        display: {
          long: "/Users/x/ABC/pier",
          short: "pier",
        },
      })
    );

    const stored = usePanelDescriptorStore.getState().descriptors["term-1"];
    expect(stored).toBeDefined();
    expect(stored?.context).toEqual(context);
    expect(stored?.display.short).toBe("pier");
    expect(setTitle).toHaveBeenCalledWith("pier");
  });

  it("descriptor without context stores only display", () => {
    const panel = { id: "term-2", setTitle: vi.fn() };
    renderHook(() =>
      usePanelDescriptor(panel, { display: { short: "Terminal" } })
    );

    const stored = usePanelDescriptorStore.getState().descriptors["term-2"];
    expect(stored).toBeDefined();
    expect(stored?.context).toBeUndefined();
    expect(stored?.display.short).toBe("Terminal");
  });
});
