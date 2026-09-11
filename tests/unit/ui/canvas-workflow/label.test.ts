import {
  asLabelObstacle,
  parkScreenFlowLabelAts,
  screenFlowLabelParkDiagnostics,
  workflowLabelPaintBox,
} from "@pier/ui/canvas-workflow/label.ts";
import {
  SCREEN_FLOW_LABEL_GAP,
  SCREEN_FLOW_LABEL_PILL,
  SCREEN_FLOW_LABEL_SCALE,
  workflowLabelWidth,
} from "@pier/ui/canvas-workflow/metrics.ts";
import type {
  WorkflowEdgeLayout,
  WorkflowNodeLayout,
} from "@pier/ui/canvas-workflow/types.ts";
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

function pillBox(edge: WorkflowEdgeLayout, nodes: WorkflowNodeLayout[]) {
  const width = Math.max(
    40,
    workflowLabelWidth(edge.label) * SCREEN_FLOW_LABEL_SCALE
  );
  const box = workflowLabelPaintBox(
    edge.points,
    edge.labelAt,
    width,
    SCREEN_FLOW_LABEL_PILL,
    nodes,
    SCREEN_FLOW_LABEL_GAP
  );
  return { h: SCREEN_FLOW_LABEL_PILL, w: width, x: box.x, y: box.y };
}

describe("parkScreenFlowLabelAts", () => {
  it("keeps both labels when two pills would overlap", () => {
    const shaft = [
      { x: 40, y: 80 },
      { x: 400, y: 80 },
    ];
    const edge = (id: string, label: string): WorkflowEdgeLayout => ({
      from: "a",
      id,
      label,
      labelAt: { x: 180, y: 80 },
      onMainPath: false,
      points: shaft,
      role: "return",
      to: "b",
    });
    const parked = parkScreenFlowLabelAts(
      [edge("e-a", "返回收件箱"), edge("e-b", "重新扫码")],
      []
    );
    expect(parked[0]?.label).toBe("返回收件箱");
    expect(parked[1]?.label).toBe("重新扫码");
    const a = parked[0] ? pillBox(parked[0], []) : undefined;
    const b =
      parked[1] && a
        ? pillBox(parked[1], [asLabelObstacle("park_0", a)])
        : undefined;
    expect(a && b).toBeTruthy();
    if (a && b) {
      expect(
        a.x + a.w + 4 <= b.x ||
          b.x + b.w + 4 <= a.x ||
          a.y + a.h + 4 <= b.y ||
          b.y + b.h + 4 <= a.y
      ).toBe(true);
    }
    expect(screenFlowLabelParkDiagnostics(parked, [])).toEqual([]);
  });

  it("parks a third pill on a long shaft without dropping labels", () => {
    const shaft = [
      { x: 40, y: 80 },
      { x: 520, y: 80 },
    ];
    const edge = (id: string, label: string): WorkflowEdgeLayout => ({
      from: "a",
      id,
      label,
      labelAt: { x: 180, y: 80 },
      onMainPath: false,
      points: shaft,
      role: "return",
      to: "b",
    });
    const parked = parkScreenFlowLabelAts(
      [
        edge("e-a", "返回收件箱"),
        edge("e-b", "重新扫码"),
        edge("e-c", "打开会话"),
      ],
      []
    );
    expect(parked.map((item) => item.label)).toEqual([
      "返回收件箱",
      "重新扫码",
      "打开会话",
    ]);
    expect(screenFlowLabelParkDiagnostics(parked, [])).toEqual([]);
  });

  it("reports leftover overlap when the shaft cannot hold the pills", () => {
    const shaft = [
      { x: 40, y: 80 },
      { x: 72, y: 80 },
    ];
    const edge = (id: string): WorkflowEdgeLayout => ({
      from: "a",
      id,
      label: "返回收件箱",
      labelAt: { x: 56, y: 80 },
      onMainPath: false,
      points: shaft,
      role: "return",
      to: "b",
    });
    const parked = parkScreenFlowLabelAts(
      [edge("e-a"), edge("e-b"), edge("e-c"), edge("e-d"), edge("e-e")],
      []
    );
    expect(parked.every((item) => item.label === "返回收件箱")).toBe(true);
    expect(screenFlowLabelParkDiagnostics(parked, []).length).toBeGreaterThan(
      0
    );
  });
});
