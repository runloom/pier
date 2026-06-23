import { beforeEach, describe, expect, it } from "vitest";
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
