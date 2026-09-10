import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileWorkflowEdges } from "@pier/ui/canvas-workflow/compile-edges.ts";
import {
  artboardBoxAsNode,
  SCREEN_FLOW_MIN_GUTTER,
  screenFlowPlacementDiagnostics,
  validateScreenFlowPaint,
} from "@pier/ui/canvas-workflow/screen-flow.ts";
import { describe, expect, it } from "vitest";
import {
  CAPTION_H,
  H_GAP,
  mobileWebShellFlowSpec,
  mobileWebShellFrameBoxes,
  PATH_H,
  V_GAP,
} from "../../../../.pier/canvases/mobile-web-shell/flow.ts";

const CANVAS = join(
  process.cwd(),
  ".pier/canvases/mobile-web-shell/mobile-web-shell.canvas.tsx"
);

describe("mobile-web-shell screen flow", () => {
  it("validates and routes the planned path without geometry errors", () => {
    expect(PATH_H).toBe(560);
    expect(H_GAP).toBeGreaterThanOrEqual(SCREEN_FLOW_MIN_GUTTER);
    expect(V_GAP).toBeGreaterThanOrEqual(SCREEN_FLOW_MIN_GUTTER);
    expect(
      validateScreenFlowPaint({
        frames: mobileWebShellFrameBoxes,
        spec: mobileWebShellFlowSpec,
      }).status
    ).toBe(0);
    const frames = mobileWebShellFrameBoxes.map((box) =>
      artboardBoxAsNode(box)
    );
    const captions = mobileWebShellFrameBoxes.map((box) =>
      artboardBoxAsNode({
        h: CAPTION_H - 10,
        id: `cap_${box.id}`,
        w: box.w,
        x: box.x,
        y: box.y - CAPTION_H,
      })
    );
    const compiled = compileWorkflowEdges({
      edges: mobileWebShellFlowSpec.edges,
      groups: [],
      lanes: [],
      mainPath: mobileWebShellFlowSpec.mainPath,
      nodes: [...frames, ...captions],
      width: Math.max(...frames.map((box) => box.x + box.w), 1),
    });
    expect(
      compiled.diagnostics.filter((item) => item.severity === "error")
    ).toEqual([]);
    expect(screenFlowPlacementDiagnostics(frames)).toEqual([]);
  });

  it("keeps recovery hops and does not cross the session column", () => {
    const roles = Object.fromEntries(
      mobileWebShellFlowSpec.edges.map((edge) => [edge.id, edge])
    );
    expect(roles["e-notice"]?.role).toBe("branch");
    expect(roles["e-open"]?.role).toBe("branch");
    expect(roles["e-files"]?.role).toBe("branch");
    expect(roles["e-retry"]?.role).toBe("return");
    expect(roles["e-retry"]?.from).toBe("disconnected");
    expect(roles["e-ended-back"]?.role).toBe("return");
    expect(roles["e-ended-back"]?.to).toBe("inbox");
    expect(
      mobileWebShellFlowSpec.edges.some(
        (edge) => edge.from === "workbench" && edge.to === "changes"
      )
    ).toBe(false);
  });

  it("gives path frames ids and keeps appendix states off the edges", () => {
    const source = readFileSync(CANVAS, "utf8");
    expect(source).toContain("ScreenFlow");
    expect(source).toContain('id="hosts"');
    expect(source).toContain('id="workbench"');
    expect(source).toContain('id="session"');
    expect(source).not.toContain("<svg");
    const edgeBlob = JSON.stringify(mobileWebShellFlowSpec.edges);
    expect(edgeBlob).not.toContain("S1n");
    expect(edgeBlob).not.toContain("S1m");
    expect(edgeBlob).not.toContain("H2l");
    expect(edgeBlob).not.toContain("S1l");
    expect(edgeBlob).not.toContain("K1");
    expect(source).not.toMatch(/id="kit/);
    expect(source).toContain("mobileWebShellFrameBoxes");
    expect(source).toContain("PATH_RIGHT");
    expect(source).toContain("appendixOrigin");
    expect(source).not.toContain('preset="phone"');
  });
});
