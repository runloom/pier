import { layoutQualityDiagnostics } from "@pier/ui/canvas-workflow/quality.ts";
import type {
  WorkflowEdgeLayout,
  WorkflowNodeLayout,
} from "@pier/ui/canvas-workflow/types.ts";
import { describe, expect, it } from "vitest";

const box: WorkflowNodeLayout = {
  detail: "",
  h: 72,
  id: "a",
  kind: "step",
  label: "A",
  tag: "",
  w: 176,
  x: 100,
  y: 80,
};

function edge(
  partial: Pick<WorkflowEdgeLayout, "id" | "points" | "labelAt"> &
    Partial<WorkflowEdgeLayout>
): WorkflowEdgeLayout {
  return {
    from: "a",
    label: "Go",
    onMainPath: false,
    role: "error",
    to: "b",
    ...partial,
  };
}

describe("layoutQualityDiagnostics", () => {
  it("rejects a last segment too short for the arrow", () => {
    const diagnostics = layoutQualityDiagnostics(
      [box],
      [
        edge({
          id: "e-short",
          labelAt: { x: 0, y: 40 },
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 4 },
          ],
        }),
      ]
    );
    expect(
      diagnostics.some((item) => item.code === "workflow/last-segment-short")
    ).toBe(true);
  });

  it("rejects a label that has drifted off the stroke", () => {
    const diagnostics = layoutQualityDiagnostics(
      [box],
      [
        edge({
          id: "e-off",
          labelAt: { x: 80, y: 40 },
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 80 },
          ],
        }),
      ]
    );
    expect(
      diagnostics.some((item) => item.code === "workflow/label-off-stroke")
    ).toBe(true);
  });

  it("accepts a knockout label on the longest run", () => {
    const diagnostics = layoutQualityDiagnostics(
      [box],
      [
        edge({
          id: "e-on",
          labelAt: { x: 0, y: 40 },
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 80 },
          ],
        }),
      ]
    );
    expect(
      diagnostics.some((item) => item.code.startsWith("workflow/label-"))
    ).toBe(false);
  });
});
