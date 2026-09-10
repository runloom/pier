import {
  artboardBoxAsNode,
  rewriteScreenFlowFixes,
  screenFlowPlacementDiagnostics,
  validateScreenFlowSpec,
} from "@pier/ui/canvas-workflow/screen-flow.ts";
import { describe, expect, it } from "vitest";
import { designMockupScreenFlowSpec } from "./fixtures.ts";

const gold = designMockupScreenFlowSpec;

describe("validateScreenFlowSpec", () => {
  it("accepts the design-mockup gold path", () => {
    expect(validateScreenFlowSpec(gold).status).toBe(0);
  });

  it("rejects a mainPath hop without an edge", () => {
    const receipt = validateScreenFlowSpec({
      ...gold,
      mainPath: ["library", "success"],
    });
    expect(receipt.status).toBe(1);
    expect(receipt.diagnostics[0]?.code).toBe("screen-flow/main-path-edge");
    expect(receipt.diagnostics[0]?.supportedFixes[0]).toContain("library");
  });

  it("rejects unlabeled parallel edges of the same role", () => {
    const receipt = validateScreenFlowSpec({
      edges: [
        { from: "a", id: "e1", label: "", to: "b" },
        { from: "a", id: "e2", label: "", to: "b" },
      ],
      title: "Path",
    });
    expect(receipt.status).toBe(1);
    expect(
      receipt.diagnostics.some(
        (item) => item.code === "screen-flow/parallel-unlabeled"
      )
    ).toBe(true);
  });

  it("rejects overlapping or too-tight artboard frames", () => {
    const overlap = screenFlowPlacementDiagnostics([
      artboardBoxAsNode({ h: 200, id: "a", w: 200, x: 0, y: 0 }),
      artboardBoxAsNode({ h: 200, id: "b", w: 200, x: 80, y: 40 }),
    ]);
    expect(overlap.some((item) => item.code === "screen-flow/overlap")).toBe(
      true
    );
    const tight = screenFlowPlacementDiagnostics([
      artboardBoxAsNode({ h: 200, id: "a", w: 200, x: 0, y: 0 }),
      artboardBoxAsNode({ h: 200, id: "b", w: 200, x: 240, y: 0 }),
    ]);
    expect(tight.some((item) => item.code === "screen-flow/tight-row")).toBe(
      true
    );
  });

  it("does not tell the author to move a Layer named after an edge", () => {
    const rewritten = rewriteScreenFlowFixes([
      {
        code: "workflow/edge-crosses-node",
        message: "Edge e-fail crosses a node.",
        severity: "error",
        subject: { edgeId: "e-fail" },
        supportedFixes: ["Move an endpoint."],
      },
    ]);
    expect(rewritten[0]?.supportedFixes[0]).not.toContain('"e-fail"');
    expect(rewritten[0]?.supportedFixes[0]).toContain("Layers on this hop");
    const caption = rewriteScreenFlowFixes([
      {
        code: "workflow/edge-crosses-node",
        message: "Edge crosses a caption.",
        severity: "error",
        subject: { nodeId: "cap_blocked" },
        supportedFixes: ["Move an endpoint."],
      },
    ]);
    expect(caption[0]?.supportedFixes[0]).toContain('"blocked"');
    expect(caption[0]?.supportedFixes[0]).not.toContain("cap_");
  });
});
