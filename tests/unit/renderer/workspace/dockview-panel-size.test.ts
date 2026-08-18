import { describe, expect, it, vi } from "vitest";
import {
  equalizeDockviewPanelGroup,
  setDockviewPanelSize,
} from "@/components/workspace/dockview-panel-size.ts";

type Orientation = "HORIZONTAL" | "VERTICAL";

interface SplitviewProbe {
  calls: Array<{ index: number; size: number }>;
  contentSize: number;
  distributeViewSizes: ReturnType<typeof vi.fn>;
  getViewSize: (index: number) => number;
  resizeView: ReturnType<typeof vi.fn>;
}

function createSplitview(sizes: number[]): SplitviewProbe {
  const currentSizes = [...sizes];
  const calls: Array<{ index: number; size: number }> = [];
  return {
    calls,
    contentSize: sizes.reduce((sum, size) => sum + size, 0),
    distributeViewSizes: vi.fn(),
    getViewSize: (index) => currentSizes[index] ?? 0,
    resizeView: vi.fn((index: number, size: number) => {
      calls.push({ index, size });
      currentSizes[index] = size;
    }),
  };
}

function branch(
  orientation: Orientation,
  children: unknown[],
  sizes: number[]
) {
  return {
    children,
    orientation,
    splitview: createSplitview(sizes),
  };
}

function leaf(panelIds: string[]) {
  return { panelIds };
}

function apiFor(
  root: unknown,
  panelIds: string[],
  groups?: Record<string, { id: string }>
) {
  const addPanel = vi.fn();
  const panels = panelIds.map((id) => ({
    group: groups?.[id],
    id,
  }));
  return {
    addPanel,
    component: { gridview: { root } },
    getPanel: (id: string) => panels.find((panel) => panel.id === id),
    panels,
  };
}

describe("dockview panel size", () => {
  it("setSize resizes only the target split parent", () => {
    const target = branch(
      "HORIZONTAL",
      [leaf(["p1"]), leaf(["p2"])],
      [200, 800]
    );
    const sibling = branch(
      "HORIZONTAL",
      [leaf(["p3"]), leaf(["p4"])],
      [100, 100]
    );
    const root = branch("VERTICAL", [target, sibling], [400, 400]);
    const api = apiFor(root, ["p1", "p2", "p3", "p4"]);

    const result = setDockviewPanelSize(api as never, {
      panelId: "p1",
      widthRatio: 0.3,
    });

    expect(result.ok).toBe(true);
    expect(target.splitview.calls).toEqual([{ index: 0, size: 300 }]);
    expect(sibling.splitview.calls).toEqual([]);
    expect(root.splitview.calls).toEqual([]);
    expect(api.addPanel).not.toHaveBeenCalled();
  });

  it("setSize is a successful no-op when the axis has no split", () => {
    const root = branch("VERTICAL", [leaf(["solo"])], [400]);
    const api = apiFor(root, ["solo"]);
    const result = setDockviewPanelSize(api as never, {
      panelId: "solo",
      widthRatio: 0.3,
    });
    expect(result.ok).toBe(true);
    expect(root.splitview.calls).toEqual([]);
    expect(api.addPanel).not.toHaveBeenCalled();
  });

  it("equalize resizes only the matching split group", () => {
    const target = branch(
      "HORIZONTAL",
      [leaf(["p1"]), leaf(["p2"])],
      [200, 800]
    );
    const sibling = branch(
      "HORIZONTAL",
      [leaf(["p3"]), leaf(["p4"])],
      [50, 150]
    );
    const root = branch("VERTICAL", [target, sibling], [400, 400]);
    const api = apiFor(root, ["p1", "p2", "p3", "p4"]);

    const result = equalizeDockviewPanelGroup(api as never, {
      axis: "horizontal",
      panelIds: ["p1"],
    });

    expect(result.ok).toBe(true);
    expect(target.splitview.calls).toEqual([
      { index: 0, size: 500 },
      { index: 1, size: 500 },
    ]);
    expect(sibling.splitview.calls).toEqual([]);
    expect(api.addPanel).not.toHaveBeenCalled();
  });

  it("setSize matches dockview leaf.view groups", () => {
    const group = { id: "g-leader", panels: [{ id: "p1" }] };
    const target = branch(
      "HORIZONTAL",
      [{ view: group }, { view: { id: "g-other", panels: [{ id: "p2" }] } }],
      [200, 800]
    );
    const api = apiFor(target, ["p1", "p2"], {
      p1: group,
      p2: { id: "g-other" },
    });
    const result = setDockviewPanelSize(api as never, {
      panelId: "p1",
      widthRatio: 0.3,
    });
    expect(result.ok).toBe(true);
    expect(target.splitview.calls).toEqual([{ index: 0, size: 300 }]);
  });

  it("setSize fails closed when the panel is listed but not in the grid", () => {
    const api = apiFor(branch("HORIZONTAL", [], [0]), ["p1"]);
    const result = setDockviewPanelSize(api as never, {
      panelId: "p1",
      widthRatio: 0.3,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("platform_unavailable");
    expect(api.addPanel).not.toHaveBeenCalled();
  });

  it("equalize rejects panels in unrelated splits", () => {
    const left = branch("HORIZONTAL", [leaf(["p1"]), leaf(["p2"])], [200, 800]);
    const right = branch("HORIZONTAL", [leaf(["p3"]), leaf(["p4"])], [50, 150]);
    const root = branch("VERTICAL", [left, right], [400, 400]);
    const api = apiFor(root, ["p1", "p2", "p3", "p4"]);

    const result = equalizeDockviewPanelGroup(api as never, {
      axis: "horizontal",
      panelIds: ["p1", "p3"],
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("invalid_command");
    expect(left.splitview.calls).toEqual([]);
    expect(right.splitview.calls).toEqual([]);
  });
});
