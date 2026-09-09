import { compileWorkflowLayout } from "@pier/ui/canvas-workflow/compile.ts";
import {
  insetTerminal,
  layoutEdgeArrow,
} from "@pier/ui/canvas-workflow/geometry.ts";
import {
  WORKFLOW_ARROW_GAP,
  WORKFLOW_ARROW_HALF,
  WORKFLOW_ARROW_OVERLAP,
  WORKFLOW_ARROW_SIZE,
  WORKFLOW_RETURN_SIDE,
  workflowLabelWidth,
} from "@pier/ui/canvas-workflow/metrics.ts";
import { describe, expect, it } from "vitest";
import {
  agentToolCallWorkflowSpec,
  reviewWorkflowSpec,
  sameColumnReturnSpec,
} from "./fixtures.ts";

function insideNode(
  point: { x: number; y: number },
  node: { h: number; w: number; x: number; y: number }
): boolean {
  return (
    point.x > node.x &&
    point.x < node.x + node.w &&
    point.y > node.y &&
    point.y < node.y + node.h
  );
}

describe("workflow edge geometry", () => {
  it("pulls the last point back along the final segment", () => {
    const points = insetTerminal(
      [
        { x: 0, y: 10 },
        { x: 40, y: 10 },
      ],
      10
    );
    expect(points).toEqual([
      { x: 0, y: 10 },
      { x: 30, y: 10 },
    ]);
  });

  it("stops the shaft at the dart base so the tip is not pierced", () => {
    const arrow = layoutEdgeArrow(
      [
        { x: 0, y: 40 },
        { x: 0, y: 0 },
      ],
      WORKFLOW_ARROW_SIZE,
      WORKFLOW_ARROW_HALF,
      WORKFLOW_ARROW_GAP,
      WORKFLOW_ARROW_OVERLAP
    );
    expect(arrow).toBeTruthy();
    if (!arrow) {
      return;
    }
    const shaft = arrow.stroke.at(-1);
    expect(shaft).toBeTruthy();
    if (!shaft) {
      return;
    }
    expect(arrow.tip.y).toBe(WORKFLOW_ARROW_GAP);
    expect(shaft.y).toBeGreaterThan(arrow.tip.y);
    expect(shaft.y - arrow.tip.y).toBeCloseTo(
      WORKFLOW_ARROW_SIZE - WORKFLOW_ARROW_OVERLAP
    );
    expect(
      Math.max(...arrow.head.map((point) => point.x)) -
        Math.min(...arrow.head.map((point) => point.x))
    ).toBeCloseTo(WORKFLOW_ARROW_HALF * 2);
  });

  it("routes a same-column retry beside the error drop, not through it", () => {
    const layout = compileWorkflowLayout(sameColumnReturnSpec);
    const fail = layout.edges.find((edge) => edge.id === "e-fail");
    const retry = layout.edges.find((edge) => edge.id === "e-retry");
    const scan = layout.nodes.find((node) => node.id === "scan");
    const lost = layout.nodes.find((node) => node.id === "fail");
    expect(fail && retry && scan && lost).toBeTruthy();
    if (!(fail && retry && scan && lost)) {
      return;
    }
    const failXs = new Set(
      fail.points
        .filter((point, index, points) => {
          const prev = points[index - 1];
          return prev && prev.x === point.x && Math.abs(prev.y - point.y) > 8;
        })
        .map((point) => point.x)
    );
    const retryXs = new Set(
      retry.points
        .filter((point, index, points) => {
          const prev = points[index - 1];
          return prev && prev.x === point.x && Math.abs(prev.y - point.y) > 8;
        })
        .map((point) => point.x)
    );
    for (const x of failXs) {
      expect(retryXs.has(x), `retry shares error x=${x}`).toBe(false);
    }
    const inbound = retry.points.at(-1);
    const before = retry.points.at(-2);
    expect(inbound && before).toBeTruthy();
    if (!(inbound && before)) {
      return;
    }
    expect(inbound.y).toBe(before.y);
    expect(Math.abs(inbound.x - before.x)).toBeGreaterThanOrEqual(
      WORKFLOW_RETURN_SIDE - 1
    );
    expect(retry.points.every((point) => !insideNode(point, scan))).toBe(true);
    expect(retry.points.every((point) => !insideNode(point, lost))).toBe(true);
    expect(
      layout.diagnostics.some(
        (item) => item.code === "workflow/edge-crosses-node"
      )
    ).toBe(false);
    expect(insideNode(retry.labelAt, lost)).toBe(false);
    expect(insideNode(retry.labelAt, scan)).toBe(false);
    expect(insideNode(fail.labelAt, lost)).toBe(false);
    expect(insideNode(fail.labelAt, scan)).toBe(false);
  });

  it("puts gold-sample labels on the run and records below the tools lane", () => {
    const layout = compileWorkflowLayout(agentToolCallWorkflowSpec);
    const consent = layout.edges.find((edge) => edge.id === "e-consent");
    const record = layout.edges.find((edge) => edge.id === "e-record");
    const deny = layout.edges.find((edge) => edge.id === "e-deny");
    const plan = layout.edges.find((edge) => edge.id === "e-plan");
    const policy = layout.lanes.find((lane) => lane.variant === "exception");
    const tools = layout.lanes.at(-1);
    const approval = layout.nodes.find((node) => node.id === "approval");
    const planner = layout.nodes.find((node) => node.id === "planner");
    expect(
      consent &&
        record &&
        deny &&
        plan &&
        policy &&
        tools &&
        approval &&
        planner
    ).toBeTruthy();
    if (
      !(
        consent &&
        record &&
        deny &&
        plan &&
        policy &&
        tools &&
        approval &&
        planner
      )
    ) {
      return;
    }
    expect(consent.labelAt.y).toBeLessThan(policy.y - 6);
    expect(consent.points.at(-1)?.x).toBe(approval.x);
    const store = layout.nodes.find((node) => node.id === "store");
    const tool = layout.nodes.find((node) => node.id === "tool");
    expect(store && tool).toBeTruthy();
    if (store && tool) {
      expect(record.labelAt.x).toBeGreaterThan(store.x + store.w);
      expect(record.labelAt.x).toBeLessThan(tool.x);
    }
    expect(record.points.some((point) => point.y > tools.y + tools.h)).toBe(
      true
    );
    expect(
      deny.points.some((point) => point.y > approval.y + approval.h + 8)
    ).toBe(true);
    const planRun = plan.points.some((point, index) => {
      const prev = plan.points[index - 1];
      return (
        prev !== undefined &&
        Math.abs(prev.y - point.y) < 1 &&
        Math.abs(prev.x - point.x) > 80 &&
        Math.abs(point.y - (planner.y + planner.h / 2)) < 8
      );
    });
    expect(planRun).toBe(true);
    expect(
      layout.diagnostics.filter((item) => item.severity === "error")
    ).toEqual([]);
  });

  it("puts the arrow tip on the target card edge", () => {
    const layout = compileWorkflowLayout(reviewWorkflowSpec);
    for (const edge of layout.edges) {
      const to = layout.nodes.find((node) => node.id === edge.to);
      const arrow = layoutEdgeArrow(
        edge.points,
        WORKFLOW_ARROW_SIZE,
        WORKFLOW_ARROW_HALF,
        WORKFLOW_ARROW_GAP,
        WORKFLOW_ARROW_OVERLAP
      );
      expect(arrow && to, edge.id).toBeTruthy();
      if (!(arrow && to)) {
        continue;
      }
      const onVertical = arrow.tip.x === to.x || arrow.tip.x === to.x + to.w;
      const onHorizontal = arrow.tip.y === to.y || arrow.tip.y === to.y + to.h;
      expect(
        onVertical || onHorizontal,
        `${edge.id} tip ${arrow.tip.x},${arrow.tip.y}`
      ).toBe(true);
      expect(insideNode(arrow.tip, to), `${edge.id} tip inside ${to.id}`).toBe(
        false
      );
      const shaft = arrow.stroke.at(-1);
      if (shaft && onVertical) {
        expect(Math.abs(shaft.y - arrow.tip.y)).toBeLessThan(1);
        expect(Math.abs(shaft.x - arrow.tip.x)).toBeGreaterThan(6);
      }
      if (shaft && onHorizontal) {
        expect(Math.abs(shaft.x - arrow.tip.x)).toBeLessThan(1);
        expect(Math.abs(shaft.y - arrow.tip.y)).toBeGreaterThan(6);
      }
    }
  });

  it("keeps every dart the same size and labels off the dart", () => {
    const layout = compileWorkflowLayout(agentToolCallWorkflowSpec);
    for (const edge of layout.edges) {
      const arrow = layoutEdgeArrow(
        edge.points,
        WORKFLOW_ARROW_SIZE,
        WORKFLOW_ARROW_HALF,
        WORKFLOW_ARROW_GAP,
        WORKFLOW_ARROW_OVERLAP
      );
      expect(arrow, edge.id).toBeTruthy();
      if (!arrow) {
        continue;
      }
      const width =
        Math.max(...arrow.head.map((point) => point.x)) -
        Math.min(...arrow.head.map((point) => point.x));
      const height =
        Math.max(...arrow.head.map((point) => point.y)) -
        Math.min(...arrow.head.map((point) => point.y));
      expect(Math.max(width, height), edge.id).toBeCloseTo(WORKFLOW_ARROW_SIZE);
      expect(Math.min(width, height), edge.id).toBeCloseTo(
        WORKFLOW_ARROW_HALF * 2
      );
      if (edge.label.trim() === "") {
        continue;
      }
      const halfW = workflowLabelWidth(edge.label) / 2;
      const dart = arrow.stroke.at(-1);
      expect(dart, edge.id).toBeTruthy();
      if (!dart) {
        continue;
      }
      expect(
        Math.hypot(edge.labelAt.x - dart.x, edge.labelAt.y - dart.y)
      ).toBeGreaterThan(halfW);
    }
  });

  it("keeps the visible tip and arrow outside the target card", () => {
    for (const spec of [
      reviewWorkflowSpec,
      sameColumnReturnSpec,
      agentToolCallWorkflowSpec,
    ]) {
      const layout = compileWorkflowLayout(spec);
      for (const edge of layout.edges) {
        const arrow = layoutEdgeArrow(
          edge.points,
          WORKFLOW_ARROW_SIZE,
          WORKFLOW_ARROW_HALF,
          WORKFLOW_ARROW_GAP,
          WORKFLOW_ARROW_OVERLAP
        );
        expect(arrow, edge.id).toBeTruthy();
        if (!arrow) {
          continue;
        }
        for (const node of layout.nodes) {
          expect(
            insideNode(arrow.tip, node),
            `${spec.title} ${edge.id} tip inside ${node.id}`
          ).toBe(false);
          const shaft = arrow.stroke.at(-1);
          if (shaft) {
            expect(
              insideNode(shaft, node),
              `${spec.title} ${edge.id} shaft inside ${node.id}`
            ).toBe(false);
          }
        }
      }
    }
  });
});
