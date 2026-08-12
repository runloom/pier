import { afterEach, describe, expect, it } from "vitest";
import { useFileTabLabelsStore } from "@/stores/file-tab-labels.store.ts";

describe("useFileTabLabelsStore", () => {
  afterEach(() => {
    useFileTabLabelsStore.setState({ byId: {}, titlesById: {} });
  });

  it("recomputes peer titles once when a conflicting tab registers", () => {
    const store = useFileTabLabelsStore.getState();
    store.register("p1", {
      groupId: "g1",
      path: "src/a.ts",
      root: "/repo",
    });
    expect(useFileTabLabelsStore.getState().titlesById.p1).toBe("a.ts");

    store.register("p2", {
      groupId: "g1",
      path: "lib/a.ts",
      root: "/repo",
    });
    const titles = useFileTabLabelsStore.getState().titlesById;
    expect(titles.p1).toBe("a.ts · src");
    expect(titles.p2).toBe("a.ts · lib");
  });

  it("does not thrash when re-registering the same identity", () => {
    const store = useFileTabLabelsStore.getState();
    store.register("p1", {
      groupId: "g1",
      path: "src/a.ts",
      root: "/repo",
    });
    const before = useFileTabLabelsStore.getState().titlesById;
    store.register("p1", {
      groupId: "g1",
      path: "src/a.ts",
      root: "/repo",
    });
    expect(useFileTabLabelsStore.getState().titlesById).toBe(before);
  });

  it("updates group in place without a gap (no intermediate unregister)", () => {
    const store = useFileTabLabelsStore.getState();
    store.register("p1", {
      groupId: "g1",
      path: "src/a.ts",
      root: "/repo",
    });
    store.register("p2", {
      groupId: "g1",
      path: "lib/a.ts",
      root: "/repo",
    });
    expect(useFileTabLabelsStore.getState().titlesById.p1).toBe("a.ts · src");

    // In-place group move: p1 still present for peer recompute on every set.
    store.register("p1", {
      groupId: "g2",
      path: "src/a.ts",
      root: "/repo",
    });
    // Cross-group same root → no decoration for either.
    expect(useFileTabLabelsStore.getState().titlesById.p1).toBe("a.ts");
    expect(useFileTabLabelsStore.getState().titlesById.p2).toBe("a.ts");
    expect(useFileTabLabelsStore.getState().byId.p1?.groupId).toBe("g2");
  });

  it("drops decoration after the peer unregisters", () => {
    const store = useFileTabLabelsStore.getState();
    store.register("p1", {
      groupId: "g1",
      path: "src/a.ts",
      root: "/repo",
    });
    store.register("p2", {
      groupId: "g1",
      path: "lib/a.ts",
      root: "/repo",
    });
    store.unregister("p2");
    expect(useFileTabLabelsStore.getState().titlesById.p1).toBe("a.ts");
    expect(useFileTabLabelsStore.getState().titlesById.p2).toBeUndefined();
  });
});
