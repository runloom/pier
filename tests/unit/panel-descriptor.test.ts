import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";

describe("PanelDescriptor store", () => {
  beforeEach(() => {
    usePanelDescriptorStore.setState({ descriptors: {}, activeId: null });
  });

  it("stores path field alongside short/long", () => {
    usePanelDescriptorStore.getState().upsert("p1", {
      short: "pier",
      long: "/Users/x/ABC/pier",
      path: "/Users/x/ABC/pier",
    });
    const d = usePanelDescriptorStore.getState().descriptors.p1;
    expect(d).toBeDefined();
    expect(d?.path).toBe("/Users/x/ABC/pier");
    expect(d?.long).toBe("/Users/x/ABC/pier");
    expect(d?.short).toBe("pier");
  });

  it("path is optional — descriptor without path is valid", () => {
    usePanelDescriptorStore.getState().upsert("p1", { short: "Welcome" });
    const d = usePanelDescriptorStore.getState().descriptors.p1;
    expect(d).toBeDefined();
    expect(d?.path).toBeUndefined();
  });
});

describe("usePanelDescriptor hook", () => {
  beforeEach(() => {
    usePanelDescriptorStore.setState({ descriptors: {}, activeId: null });
  });

  it("upserts path field into store and sets tab title to short", () => {
    const setTitle = vi.fn();
    const panel = { id: "term-1", setTitle };

    renderHook(() =>
      usePanelDescriptor(panel, {
        short: "pier",
        long: "/Users/x/ABC/pier",
        path: "/Users/x/ABC/pier",
      })
    );

    const stored = usePanelDescriptorStore.getState().descriptors["term-1"];
    expect(stored).toBeDefined();
    expect(stored?.path).toBe("/Users/x/ABC/pier");
    expect(setTitle).toHaveBeenCalledWith("pier");
  });

  it("descriptor without path stores only short/long", () => {
    const panel = { id: "term-2", setTitle: vi.fn() };
    renderHook(() => usePanelDescriptor(panel, { short: "Terminal" }));

    const stored = usePanelDescriptorStore.getState().descriptors["term-2"];
    expect(stored).toBeDefined();
    expect(stored?.path).toBeUndefined();
    expect(stored?.short).toBe("Terminal");
  });
});
