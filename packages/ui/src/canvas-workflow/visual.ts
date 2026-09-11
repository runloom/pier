import { layoutEdgeArrow, longestSegment } from "./geometry.ts";
import {
  WORKFLOW_ARROW_GAP,
  WORKFLOW_ARROW_HALF,
  WORKFLOW_ARROW_OVERLAP,
  WORKFLOW_ARROW_SIZE,
  WORKFLOW_STROKE,
  WORKFLOW_STROKE_SIDE,
} from "./metrics.ts";
import { workflowEdgeStrokeVar, workflowPaintRole } from "./role.ts";
import type {
  WorkflowEdgeLayout,
  WorkflowLayout,
  WorkflowNodeLayout,
} from "./types.ts";

function laneVariantAt(
  node: WorkflowNodeLayout | undefined,
  lanes: WorkflowLayout["lanes"]
): "default" | "exception" | undefined {
  if (!node) {
    return;
  }
  return lanes.find(
    (lane) => node.y >= lane.y - 1 && node.y <= lane.y + lane.h + 1
  )?.variant;
}

export type EdgePaintKind = "diagram" | "screens";

export function edgeVisual(
  edge: WorkflowEdgeLayout,
  layout: WorkflowLayout,
  kind: EdgePaintKind = "diagram"
) {
  const fromNode = layout.nodes.find((node) => node.id === edge.from);
  const toNode = layout.nodes.find((node) => node.id === edge.to);
  const paintRole = workflowPaintRole(
    edge.onMainPath,
    edge.role,
    laneVariantAt(fromNode, layout.lanes) === "exception",
    laneVariantAt(toNode, layout.lanes) === "exception"
  );
  let markRole = paintRole;
  if (kind !== "screens" && paintRole === "main" && !edge.onMainPath) {
    const run = longestSegment(edge.points);
    const sameRow =
      fromNode !== undefined &&
      toNode !== undefined &&
      Math.abs(fromNode.y + fromNode.h / 2 - (toNode.y + toNode.h / 2)) < 8;
    const between =
      fromNode !== undefined && toNode !== undefined
        ? toNode.x - (fromNode.x + fromNode.w)
        : 0;
    const sequential = sameRow && between > 0 && between < 240;
    if (!(run >= 72 && !sequential)) {
      markRole = "branch";
    }
  }
  return {
    arrow: layoutEdgeArrow(
      edge.points,
      WORKFLOW_ARROW_SIZE,
      WORKFLOW_ARROW_HALF,
      WORKFLOW_ARROW_GAP,
      WORKFLOW_ARROW_OVERLAP
    ),
    paintRole,
    stroke: workflowEdgeStrokeVar(markRole),
    width: paintRole === "main" ? WORKFLOW_STROKE : WORKFLOW_STROKE_SIDE,
  };
}
