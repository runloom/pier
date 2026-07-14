import type { WorkbenchPanelWidgetEntry } from "@shared/contracts/workbench.ts";
import {
  getCompactor,
  moveElement as moveGridElement,
} from "react-grid-layout";
import { describe, expect, it } from "vitest";
import {
  deriveOrderedWorkbenchLayout,
  moveWorkbenchEntry,
  resolveResponsiveGridCols,
  resolveWorkbenchInsertionIndex,
  workbenchLayoutRows,
} from "@/panel-kits/workbench/workbench-ordered-layout.ts";

function entry(id: string, w: number, h: number): WorkbenchPanelWidgetEntry {
  return { h, id, w };
}

describe("responsive ordered Workbench layout", () => {
  it.each([
    [0, 2],
    [188, 2],
    [388, 4],
    [800, 8],
    [1300, 12],
  ])("maps %ipx to %i columns", (width, expected) => {
    expect(resolveResponsiveGridCols(width)).toBe(expected);
  });

  it("packs in strict Z order and uses the tallest item as row height", () => {
    const layout = deriveOrderedWorkbenchLayout(
      [entry("a", 4, 2), entry("b", 3, 5), entry("c", 4, 2)],
      { cols: 8 }
    );

    expect(layout.map(({ h, i, w, x, y }) => ({ h, i, w, x, y }))).toEqual([
      { h: 2, i: "a", w: 4, x: 0, y: 0 },
      { h: 5, i: "b", w: 3, x: 4, y: 0 },
      { h: 2, i: "c", w: 4, x: 0, y: 5 },
    ]);
    expect(workbenchLayoutRows(layout)).toBe(7);
  });

  it("does not backfill later items into vertical gaps", () => {
    const layout = deriveOrderedWorkbenchLayout(
      [entry("tall", 5, 6), entry("short", 3, 2), entry("next", 3, 2)],
      { cols: 8 }
    );

    expect(layout.find((item) => item.i === "next")).toMatchObject({
      x: 0,
      y: 6,
    });
  });

  it("temporarily clamps width in a narrow container without mutating preference", () => {
    const widgets = [entry("wide", 8, 3)];

    expect(deriveOrderedWorkbenchLayout(widgets, { cols: 4 })[0]).toMatchObject(
      { w: 4 }
    );
    expect(widgets[0]).toMatchObject({ w: 8 });
    expect(
      deriveOrderedWorkbenchLayout(widgets, { cols: 12 })[0]
    ).toMatchObject({ w: 8 });
  });

  it("uses host persistence bounds when a widget declaration is unavailable", () => {
    const [item] = deriveOrderedWorkbenchLayout([entry("unknown", 1, 1)], {
      cols: 12,
    });

    expect(item).toMatchObject({
      h: 2,
      maxH: 12,
      maxW: 12,
      minH: 2,
      minW: 2,
      w: 2,
    });
  });

  it("moves only the ordered instance and keeps all entry data", () => {
    const widgets = [entry("a", 2, 2), entry("b", 3, 4), entry("c", 4, 3)];
    const moved = moveWorkbenchEntry(widgets, "c", 1);

    expect(moved.map((widget) => widget.id)).toEqual(["a", "c", "b"]);
    expect(moved[1]).toEqual(widgets[2]);
  });

  it("chooses the nearest ordered insertion slot for pointer dragging", () => {
    const widgets = [entry("a", 4, 3), entry("b", 4, 3), entry("c", 4, 3)];

    expect(
      resolveWorkbenchInsertionIndex(widgets, {
        activeItem: { h: 3, w: 4, x: 0, y: 3 },
        cols: 8,
        instanceId: "a",
      })
    ).toBe(2);
  });

  it("does not let RGL displace siblings during repeated drag collisions", () => {
    const compactor = getCompactor(null, true);
    let layout = deriveOrderedWorkbenchLayout(
      [entry("a", 4, 3), entry("b", 4, 3), entry("c", 4, 3)],
      { cols: 8 }
    );
    let active = layout.find((item) => item.i === "c");
    if (!active) throw new Error("missing active layout item");

    layout = moveGridElement(
      layout,
      active,
      0,
      0,
      true,
      compactor.preventCollision,
      compactor.type,
      8,
      compactor.allowOverlap
    );
    active = layout.find((item) => item.i === "c");
    if (!active) throw new Error("missing moved layout item");
    layout = moveGridElement(
      layout,
      active,
      4,
      0,
      true,
      compactor.preventCollision,
      compactor.type,
      8,
      compactor.allowOverlap
    );

    expect(
      layout
        .filter((item) => item.i !== "c")
        .map(({ i, x, y }) => ({ i, x, y }))
    ).toEqual([
      { i: "a", x: 0, y: 0 },
      { i: "b", x: 4, y: 0 },
    ]);
  });
});
