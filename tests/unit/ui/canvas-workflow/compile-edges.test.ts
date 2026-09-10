import { compileWorkflowEdges } from "@pier/ui/canvas-workflow/compile-edges.ts";
import { SCREEN_FLOW_RETURN_SIDE } from "@pier/ui/canvas-workflow/metrics.ts";
import { artboardBoxAsNode } from "@pier/ui/canvas-workflow/screen-flow.ts";
import type { WorkflowNodeLayout } from "@pier/ui/canvas-workflow/types.ts";
import { describe, expect, it } from "vitest";

function box(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number
): WorkflowNodeLayout {
  return artboardBoxAsNode({ h, id, w, x, y });
}

describe("compileWorkflowEdges", () => {
  it("routes phone-sized frames on a happy path without quality errors", () => {
    const nodes = [
      box("library", 40, 40, 393, 852),
      box("detail", 713, 40, 393, 852),
      box("confirm", 1386, 40, 393, 852),
      box("success", 2059, 40, 393, 852),
    ];
    const compiled = compileWorkflowEdges({
      edges: [
        { from: "library", id: "e-open", label: "Tap asset", to: "detail" },
        { from: "detail", id: "e-upload", label: "Tap Upload", to: "confirm" },
        { from: "confirm", id: "e-send", label: "Confirm", to: "success" },
      ],
      groups: [],
      lanes: [],
      mainPath: ["library", "detail", "confirm", "success"],
      nodes,
      width: 2600,
    });
    expect(
      compiled.diagnostics.filter((item) => item.severity === "error")
    ).toEqual([]);
    expect(compiled.edges).toHaveLength(3);
    expect(compiled.edges.every((edge) => edge.points.length >= 2)).toBe(true);
  });

  it("routes a same-column error drop and C-shaped return", () => {
    const nodes = [
      box("confirm", 1386, 40, 393, 852),
      box("blocked", 1386, 1200, 393, 852),
    ];
    const compiled = compileWorkflowEdges({
      edges: [
        {
          from: "confirm",
          id: "e-fail",
          label: "Validation failed",
          role: "error",
          to: "blocked",
        },
        {
          from: "blocked",
          id: "e-retry",
          label: "Fix file",
          role: "return",
          to: "confirm",
        },
      ],
      groups: [],
      lanes: [],
      nodes,
      width: 2000,
    });
    expect(
      compiled.diagnostics.filter((item) => item.severity === "error")
    ).toEqual([]);
    const retry = compiled.edges.find((edge) => edge.id === "e-retry");
    const fail = compiled.edges.find((edge) => edge.id === "e-fail");
    const blocked = nodes[1];
    expect(retry?.points.length).toBeGreaterThanOrEqual(4);
    const xs = new Set(retry?.points.map((point) => Math.round(point.x)));
    expect(xs.size).toBeGreaterThan(1);
    const failTip = fail?.points.at(-1);
    expect(failTip && blocked).toBeTruthy();
    if (failTip && blocked) {
      const onLeft = Math.abs(failTip.x - blocked.x) < 1;
      const onRight = Math.abs(failTip.x - (blocked.x + blocked.w)) < 1;
      expect(onLeft || onRight).toBe(true);
      expect(Math.abs(failTip.y - blocked.y)).toBeGreaterThan(8);
    }
    const retryXs = retry?.points.map((point) => point.x) ?? [];
    expect(blocked && retryXs.length > 0).toBeTruthy();
    if (!(blocked && retryXs.length > 0)) {
      return;
    }
    const rightClear =
      Math.max(...retryXs) >=
      blocked.x + blocked.w + SCREEN_FLOW_RETURN_SIDE - 1;
    const leftClear =
      Math.min(...retryXs) <= blocked.x - SCREEN_FLOW_RETURN_SIDE + 1;
    expect(rightClear || leftClear).toBe(true);
    if (failTip) {
      const failLeft = Math.abs(failTip.x - blocked.x) < 1;
      const retryRight = Math.max(...retryXs) > blocked.x + blocked.w;
      expect(failLeft).toBe(retryRight);
    }
  });

  it("does not send a same-column screen hop through a caption", () => {
    const confirm = box("confirm", 1234, 40, 393, 560);
    const blocked = box("blocked", 1234, 820, 393, 560);
    const caption = box("cap_blocked", 1234, 760, 393, 52);
    const compiled = compileWorkflowEdges({
      edges: [{ from: "blocked", id: "e-up", label: "Retry", to: "confirm" }],
      groups: [],
      lanes: [],
      nodes: [confirm, blocked, caption],
      width: 2400,
    });
    expect(
      compiled.diagnostics.filter((item) => item.severity === "error")
    ).toEqual([]);
    const tip = compiled.edges
      .find((edge) => edge.id === "e-up")
      ?.points.at(-1);
    expect(tip && Math.abs(tip.y - confirm.y) > 8).toBe(true);
  });

  it("routes desktop-sized frames", () => {
    const nodes = [
      box("home", 40, 40, 1280, 800),
      box("next", 1480, 40, 1280, 800),
    ];
    const compiled = compileWorkflowEdges({
      edges: [{ from: "home", id: "e-go", label: "Continue", to: "next" }],
      groups: [],
      lanes: [],
      nodes,
      width: 3000,
    });
    expect(
      compiled.diagnostics.filter((item) => item.severity === "error")
    ).toEqual([]);
  });

  it("keeps a same-column return off the happy-path hop", () => {
    const nodes = [
      box("library", 40, 40, 393, 560),
      box("detail", 641, 40, 393, 560),
      box("confirm", 1234, 40, 393, 560),
      box("success", 1827, 40, 393, 560),
      box("blocked", 1234, 820, 393, 560),
    ];
    const compiled = compileWorkflowEdges({
      edges: [
        { from: "library", id: "e-open", label: "Tap asset", to: "detail" },
        { from: "detail", id: "e-upload", label: "Tap Upload", to: "confirm" },
        { from: "confirm", id: "e-send", label: "Confirm", to: "success" },
        {
          from: "confirm",
          id: "e-fail",
          label: "Validation failed",
          role: "error",
          to: "blocked",
        },
        {
          from: "blocked",
          id: "e-retry",
          label: "Fix file",
          role: "return",
          to: "confirm",
        },
      ],
      groups: [],
      lanes: [],
      mainPath: ["library", "detail", "confirm", "success"],
      nodes,
      width: 2400,
    });
    expect(
      compiled.diagnostics.filter((item) => item.severity === "error")
    ).toEqual([]);
    const hop = compiled.edges.find((edge) => edge.id === "e-send");
    const retry = compiled.edges.find((edge) => edge.id === "e-retry");
    expect(hop && retry).toBeTruthy();
    if (!(hop && retry)) {
      return;
    }
    let hopY = 0;
    let hopLeft = Number.POSITIVE_INFINITY;
    let hopRight = Number.NEGATIVE_INFINITY;
    for (let i = 1; i < hop.points.length; i += 1) {
      const a = hop.points[i - 1];
      const b = hop.points[i];
      if (!(a && b) || Math.abs(a.y - b.y) >= 1) {
        continue;
      }
      hopY = a.y;
      hopLeft = Math.min(hopLeft, a.x, b.x);
      hopRight = Math.max(hopRight, a.x, b.x);
    }
    let crosses = false;
    for (let i = 1; i < retry.points.length; i += 1) {
      const a = retry.points[i - 1];
      const b = retry.points[i];
      if (!(a && b) || Math.abs(a.x - b.x) >= 1) {
        continue;
      }
      const top = Math.min(a.y, b.y);
      const bottom = Math.max(a.y, b.y);
      if (a.x >= hopLeft && a.x <= hopRight && hopY >= top && hopY <= bottom) {
        crosses = true;
      }
    }
    expect(crosses).toBe(false);
  });
});
