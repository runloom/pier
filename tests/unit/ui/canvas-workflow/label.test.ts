import { workflowLabelPaintBox } from "@pier/ui/canvas-workflow/label.ts";
import type { WorkflowNodeLayout } from "@pier/ui/canvas-workflow/types.ts";
import { describe, expect, it } from "vitest";

const card: WorkflowNodeLayout = {
  detail: "",
  h: 52,
  id: "a",
  kind: "step",
  label: "A",
  tag: "",
  w: 132,
  x: 40,
  y: 40,
};

describe("workflowLabelPaintBox", () => {
  it("parks a horizontal label above the shaft, not on the ink", () => {
    const labelAt = { x: 200, y: 66 };
    const box = workflowLabelPaintBox(
      [
        { x: 172, y: 66 },
        { x: 260, y: 66 },
      ],
      labelAt,
      48,
      18,
      [{ ...card, y: 200 }],
      4
    );
    expect(box.y + 18).toBeLessThanOrEqual(labelAt.y);
    expect(box.x + 24).toBeCloseTo(labelAt.x);
  });

  it("parks a floor-channel label below the shaft when above would hit a card", () => {
    const labelAt = { x: 106, y: 100 };
    const box = workflowLabelPaintBox(
      [
        { x: 40, y: 100 },
        { x: 172, y: 100 },
      ],
      labelAt,
      48,
      18,
      [card],
      6
    );
    expect(box.y).toBeGreaterThanOrEqual(labelAt.y);
  });

  it("parks a vertical label beside the shaft", () => {
    const labelAt = { x: 106, y: 180 };
    const box = workflowLabelPaintBox(
      [
        { x: 106, y: 92 },
        { x: 106, y: 240 },
      ],
      labelAt,
      64,
      18,
      [card],
      4
    );
    expect(box.x === labelAt.x + 4 || box.x + 64 === labelAt.x - 4).toBe(true);
  });
});
