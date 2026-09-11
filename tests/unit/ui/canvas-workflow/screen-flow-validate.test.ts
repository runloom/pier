import {
  artboardBoxAsNode,
  rewriteScreenFlowFixes,
  SCREEN_FLOW_START_CHIP_GAP,
  screenFlowCrossingErrors,
  screenFlowPlacementDiagnostics,
  screenFlowStartChipPosition,
  screenFlowStartChipSize,
  validateScreenFlowPaint,
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
    const zoomNoise = screenFlowPlacementDiagnostics([
      artboardBoxAsNode({ h: 200, id: "hosts", w: 393, x: 40, y: 192 }),
      artboardBoxAsNode({
        h: 200,
        id: "workbench",
        w: 393,
        x: 40 + 393 + 119.6,
        y: 192,
      }),
    ]);
    expect(zoomNoise).toEqual([]);
  });

  it("slides the start title chip beside the caption when a layer occupies the band above", () => {
    const caption = { h: 22, id: "hosts", w: 393, x: 40, y: 152 };
    const frame = { h: 560, id: "hosts", w: 393, x: 40, y: 192 };
    const next = { h: 560, id: "workbench", w: 393, x: 40 + 393 + 140, y: 192 };
    const note = { h: 88, id: "layer", w: 1400, x: 40, y: 40 };
    const startLayer = { h: 600, id: "layer", w: 393, x: 40, y: 152 };
    const nextLayer = { h: 600, id: "layer", w: 393, x: next.x, y: 152 };
    const title = "先选电脑，再投影";
    const chip = screenFlowStartChipSize(title);
    const clear = screenFlowStartChipPosition({
      caption,
      frames: [frame, next],
      layers: [startLayer],
      startId: "hosts",
      title,
    });
    expect(clear.top).toBeLessThan(caption.y);
    const dodged = screenFlowStartChipPosition({
      caption,
      frames: [frame, next],
      layers: [startLayer, nextLayer, note],
      startId: "hosts",
      title,
    });
    expect(dodged.left).toBe(
      caption.x + caption.w + SCREEN_FLOW_START_CHIP_GAP
    );
    expect(dodged.left + chip.w).toBeLessThanOrEqual(next.x);
    expect(dodged.top).toBe(caption.y);
    const longTitle = "Upload an asset";
    const longChip = screenFlowStartChipSize(longTitle);
    const crowded = screenFlowStartChipPosition({
      caption,
      frames: [frame, next],
      layers: [startLayer, nextLayer, note],
      startId: "hosts",
      title: longTitle,
    });
    expect(crowded.left + longChip.w).toBeLessThanOrEqual(next.x);
    expect(crowded.left).toBe(caption.x);
  });

  it("does not Empty on workflow quality codes other than through-box", () => {
    const quality = screenFlowCrossingErrors([
      {
        code: "workflow/last-segment-short",
        message: "short",
        severity: "error",
        subject: { edgeId: "e-open" },
        supportedFixes: ["Move an endpoint."],
      },
      {
        code: "workflow/edge-crosses-node",
        message: "cross",
        severity: "error",
        subject: { edgeId: "e-open", nodeId: "mid" },
        supportedFixes: ["Move an endpoint."],
      },
    ]);
    expect(quality).toHaveLength(1);
    expect(quality[0]?.code).toBe("workflow/edge-crosses-node");
  });

  it("fails the author-time paint gate on a missing frame or tight gutter", () => {
    const frames = [
      { h: 200, id: "library", w: 200, x: 0, y: 80 },
      { h: 200, id: "detail", w: 200, x: 240, y: 80 },
    ];
    const tight = validateScreenFlowPaint({
      frames,
      spec: {
        edges: [{ from: "library", id: "e-open", label: "Open", to: "detail" }],
        title: "Upload",
      },
    });
    expect(tight.status).toBe(1);
    expect(tight.diagnostics[0]?.supportedFixes[0]).toContain("detail");
    const missing = validateScreenFlowPaint({
      frames: [frames[0]!],
      spec: {
        edges: [{ from: "library", id: "e-open", label: "Open", to: "detail" }],
        title: "Upload",
      },
    });
    expect(missing.status).toBe(1);
    expect(missing.diagnostics[0]?.code).toBe("screen-flow/missing-artboard");
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
