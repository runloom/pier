import { compileWorkflowLayout } from "@pier/ui/canvas-workflow/compile.ts";
import {
  WORKFLOW_ARROW_SIZE,
  WORKFLOW_COL_GAP,
  WORKFLOW_LANE_GUTTER,
  WORKFLOW_NODE_WIDTH,
  workflowLabelWidth,
} from "@pier/ui/canvas-workflow/metrics.ts";
import type { WorkflowSpec } from "@pier/ui/canvas-workflow/types.ts";
import { describe, expect, it } from "vitest";
import {
  agentToolCallWorkflowSpec,
  crossingWorkflowSpec,
  reviewWorkflowSpec,
} from "./fixtures.ts";

describe("compileWorkflowLayout", () => {
  it("places nodes on the lane/col grid", () => {
    const layout = compileWorkflowLayout(reviewWorkflowSpec);
    const submit = layout.nodes.find((node) => node.id === "submit");
    const review = layout.nodes.find((node) => node.id === "review");
    const reject = layout.nodes.find((node) => node.id === "reject");
    expect(submit?.x).toBe(WORKFLOW_LANE_GUTTER);
    expect(review?.x).toBeGreaterThan(
      WORKFLOW_LANE_GUTTER + WORKFLOW_NODE_WIDTH + WORKFLOW_COL_GAP - 1
    );
    expect(reject?.y).toBeGreaterThan(submit?.y ?? 0);
  });

  it("widens a same-lane gap so the label sits between the cards", () => {
    const spec: WorkflowSpec = {
      edges: [{ from: "tree", id: "e-click", label: "点开文件", to: "open" }],
      lanes: [{ id: "happy", label: "主路径" }],
      nodes: [
        { col: 0, id: "tree", label: "文件树", lane: "happy" },
        { col: 1, id: "open", label: "打开文件", lane: "happy" },
      ],
      title: "Files",
    };
    const layout = compileWorkflowLayout(spec);
    const tree = layout.nodes.find((node) => node.id === "tree");
    const open = layout.nodes.find((node) => node.id === "open");
    const click = layout.edges.find((edge) => edge.id === "e-click");
    expect(tree && open && click).toBeTruthy();
    if (!(tree && open && click)) {
      return;
    }
    const gap = open.x - (tree.x + tree.w);
    const pill = workflowLabelWidth("点开文件");
    expect(gap).toBeGreaterThanOrEqual(pill + WORKFLOW_ARROW_SIZE);
    const half = pill / 2;
    expect(click.labelAt.x - half).toBeGreaterThanOrEqual(tree.x + tree.w);
    expect(click.labelAt.x + half).toBeLessThanOrEqual(
      open.x - WORKFLOW_ARROW_SIZE + 1
    );
  });

  it("keeps lane captions and marks the happy-path walk", () => {
    const layout = compileWorkflowLayout(reviewWorkflowSpec);
    expect(layout.lanes.map((lane) => lane.label)).toEqual([
      "Happy path",
      "Recover",
    ]);
    expect(layout.lanes[1]?.variant).toBe("exception");
    expect(layout.lanes[0]?.h).toBeGreaterThan(layout.nodes[0]?.h ?? 0);
    expect(layout.edges.find((edge) => edge.id === "e-open")?.onMainPath).toBe(
      true
    );
    expect(layout.edges.find((edge) => edge.id === "e-pass")?.onMainPath).toBe(
      true
    );
    expect(
      layout.edges.find((edge) => edge.id === "e-reject")?.onMainPath
    ).toBe(false);
  });

  it("keeps role colors distinct and return edges below the boxes", () => {
    const layout = compileWorkflowLayout(reviewWorkflowSpec);
    const roles = new Set(layout.edges.map((edge) => edge.role));
    expect(roles).toEqual(new Set(["main", "error", "return", "branch"]));
    const ret = layout.edges.find((edge) => edge.role === "return");
    const from = layout.nodes.find((node) => node.id === ret?.from);
    const to = layout.nodes.find((node) => node.id === ret?.to);
    const lowest = Math.max(
      (from?.y ?? 0) + (from?.h ?? 0),
      (to?.y ?? 0) + (to?.h ?? 0)
    );
    expect(ret?.points.some((point) => point.y > lowest)).toBe(true);
  });

  it("places phase headers, groups, and caption notes on the gold sample", () => {
    const layout = compileWorkflowLayout(agentToolCallWorkflowSpec);
    expect(layout.phases.map((phase) => phase.id)).toEqual([
      "intake",
      "reasoning",
      "execution",
    ]);
    expect(layout.groups.map((group) => group.id)).toEqual([
      "agent_loop",
      "exception_path",
      "evidence_path",
      "tool_work",
    ]);
    expect(layout.legend.map((item) => item.kind)).toEqual([
      "step",
      "gate",
      "system",
      "store",
      "external",
    ]);
    expect(layout.notes).toHaveLength(2);
    expect(layout.nodes).toHaveLength(12);
    expect(layout.nodes.find((node) => node.id === "approval")?.kind).toBe(
      "gate"
    );
    expect(layout.nodes.find((node) => node.id === "approval")?.tag).toBe("");
    expect(new Set(layout.nodes.map((node) => node.h)).size).toBe(1);
    expect(layout.nodes.find((node) => node.id === "user")?.kind).toBe(
      "external"
    );
    expect(
      layout.diagnostics.filter((item) => item.severity === "error")
    ).toEqual([]);
  });

  it("reports a crossing instead of routing around the box", () => {
    const layout = compileWorkflowLayout(crossingWorkflowSpec());
    expect(
      layout.diagnostics.some(
        (item) => item.code === "workflow/edge-crosses-node"
      )
    ).toBe(true);
  });
});
