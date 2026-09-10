import { compileWorkflowLayout } from "@pier/ui/canvas-workflow/compile.ts";
import { compileWorkflowEdges } from "@pier/ui/canvas-workflow/compile-edges.ts";
import {
  artboardBoxAsNode,
  validateScreenFlowSpec,
} from "@pier/ui/canvas-workflow/screen-flow.ts";
import type { WorkflowSpec } from "@pier/ui/canvas-workflow/types.ts";
import { validateWorkflowSpec } from "@pier/ui/canvas-workflow/validate.ts";
import { describe, expect, it } from "vitest";
import {
  agentToolCallWorkflowSpec,
  designMockupFrameBoxes,
  designMockupScreenFlowSpec,
  reviewWorkflowSpec,
  sameColumnReturnSpec,
} from "./fixtures.ts";

function geometryErrors(spec: WorkflowSpec) {
  const receipt = validateWorkflowSpec(spec);
  const layout = compileWorkflowLayout(spec);
  return {
    layout: layout.diagnostics.filter((item) => item.severity === "error"),
    receipt,
  };
}

describe("canvas workflow closed set", () => {
  it("paints the gallery gold, review path, and same-column retry", () => {
    for (const spec of [
      agentToolCallWorkflowSpec,
      reviewWorkflowSpec,
      sameColumnReturnSpec,
    ]) {
      const { layout, receipt } = geometryErrors(spec);
      expect(receipt.status, spec.title).toBe(0);
      expect(layout, spec.title).toEqual([]);
    }
  });

  it("accepts the design-mockup path and routes its frames", () => {
    expect(validateScreenFlowSpec(designMockupScreenFlowSpec).status).toBe(0);
    const compiled = compileWorkflowEdges({
      edges: designMockupScreenFlowSpec.edges,
      groups: [],
      lanes: [],
      mainPath: designMockupScreenFlowSpec.mainPath,
      nodes: designMockupFrameBoxes.map((box) => artboardBoxAsNode(box)),
      width: 2400,
    });
    expect(
      compiled.diagnostics.filter((item) => item.severity === "error")
    ).toEqual([]);
    expect(compiled.edges).toHaveLength(5);
  });

  it("routes a desktop-sized hop with the same engine", () => {
    const compiled = compileWorkflowEdges({
      edges: [{ from: "home", id: "e-go", label: "Continue", to: "next" }],
      groups: [],
      lanes: [],
      nodes: [
        artboardBoxAsNode({ h: 800, id: "home", w: 1280, x: 40, y: 40 }),
        artboardBoxAsNode({ h: 800, id: "next", w: 1280, x: 1480, y: 40 }),
      ],
      width: 3000,
    });
    expect(
      compiled.diagnostics.filter((item) => item.severity === "error")
    ).toEqual([]);
  });
});
