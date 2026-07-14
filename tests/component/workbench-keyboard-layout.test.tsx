import type { WorkbenchPanelWidgetEntry } from "@shared/contracts/workbench.ts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { applyKeyboardLayoutChange } from "@/panel-kits/workbench/workbench-keyboard-layout.ts";
import { WorkbenchPanel } from "@/panel-kits/workbench/workbench-panel.tsx";
import {
  installWorkbenchTestHarness,
  makeProps,
} from "./workbench-test-harness.ts";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

installWorkbenchTestHarness();

const widgets: WorkbenchPanelWidgetEntry[] = [
  { h: 3, id: "a", w: 4 },
  { h: 3, id: "b", w: 4 },
  { h: 3, id: "c", w: 4 },
];

describe("ordered grid keyboard changes", () => {
  it.each([
    ["ArrowLeft", ["b", "a", "c"]],
    ["ArrowUp", ["b", "a", "c"]],
    ["ArrowRight", ["a", "c", "b"]],
    ["ArrowDown", ["a", "c", "b"]],
  ])("%s moves one position in reading order", (key, expected) => {
    const change = applyKeyboardLayoutChange(widgets, "b", key, false);

    expect(change?.kind).toBe("move");
    expect(change?.widgets.map((widget) => widget.id)).toEqual(expected);
  });

  it("Shift+arrows resize preferred dimensions within bounds", () => {
    const wider = applyKeyboardLayoutChange(widgets, "b", "ArrowRight", true, {
      max: { h: 6, w: 6 },
      min: { h: 2, w: 2 },
    });
    const shorter = applyKeyboardLayoutChange(
      wider!.widgets,
      "b",
      "ArrowUp",
      true,
      {
        max: { h: 6, w: 6 },
        min: { h: 2, w: 2 },
      }
    );

    expect(wider?.widgets[1]).toMatchObject({ h: 3, w: 5 });
    expect(shorter?.widgets[1]).toMatchObject({ h: 2, w: 5 });
  });

  it("returns null at order and size boundaries", () => {
    expect(
      applyKeyboardLayoutChange(widgets, "a", "ArrowLeft", false)
    ).toBeNull();
    expect(
      applyKeyboardLayoutChange(
        [{ h: 2, id: "a", w: 2 }],
        "a",
        "ArrowLeft",
        true,
        { max: { h: 4, w: 4 }, min: { h: 2, w: 2 } }
      )
    ).toBeNull();
  });
});

describe("WorkbenchPanel keyboard persistence", () => {
  it("ArrowRight on the handle persists a new array order", () => {
    const updateParameters = vi.fn();
    render(
      <WorkbenchPanel
        {...makeProps(
          {
            layoutVersion: 3,
            widgets: [
              { h: 3, id: "core.activity-overview", w: 4 },
              { h: 4, id: "core.system-resources", w: 4 },
            ],
          },
          updateParameters
        )}
      />
    );

    fireEvent.keyDown(
      screen.getByRole("button", {
        name: /Reorder or resize Activity Overview/i,
      }),
      { key: "ArrowRight" }
    );

    expect(updateParameters).toHaveBeenCalledWith({
      layoutVersion: 3,
      widgets: [
        { h: 4, id: "core.system-resources", w: 4 },
        { h: 3, id: "core.activity-overview", w: 4 },
      ],
    });
  });

  it("Shift+ArrowRight persists a larger preferred width", () => {
    const updateParameters = vi.fn();
    render(
      <WorkbenchPanel
        {...makeProps(
          {
            layoutVersion: 3,
            widgets: [{ h: 3, id: "core.activity-overview", w: 4 }],
          },
          updateParameters
        )}
      />
    );

    fireEvent.keyDown(
      screen.getByRole("button", {
        name: /Reorder or resize Activity Overview/i,
      }),
      { key: "ArrowRight", shiftKey: true }
    );

    expect(updateParameters).toHaveBeenCalledWith({
      layoutVersion: 3,
      widgets: [{ h: 3, id: "core.activity-overview", w: 5 }],
    });
  });
});
