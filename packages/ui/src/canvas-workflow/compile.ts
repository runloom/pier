import { placeWorkflowFrames, workflowBoardChrome } from "./frame.ts";
import { layoutEdgeArrow } from "./geometry.ts";
import { workflowLegendItems } from "./kind.ts";
import {
  WORKFLOW_ARROW_GAP,
  WORKFLOW_ARROW_HALF,
  WORKFLOW_ARROW_OVERLAP,
  WORKFLOW_ARROW_SIZE,
  WORKFLOW_LABEL_MAX,
} from "./metrics.ts";
import {
  laneFloorFor,
  laneFor,
  routeWorkflowEdge,
  segmentHitsRect,
  workflowLabelAt,
} from "./path.ts";
import { layoutQualityDiagnostics } from "./quality.ts";
import { workflowEdgeRole } from "./role.ts";
import type {
  WorkflowDiagnostic,
  WorkflowEdgeLayout,
  WorkflowLayout,
  WorkflowNodeLayout,
  WorkflowPoint,
  WorkflowSpec,
} from "./types.ts";

function crossingDiagnostics(
  nodes: readonly WorkflowNodeLayout[],
  edges: readonly WorkflowEdgeLayout[]
): WorkflowDiagnostic[] {
  const out: WorkflowDiagnostic[] = [];
  for (const edge of edges) {
    for (const node of nodes) {
      if (node.id === edge.from || node.id === edge.to) {
        continue;
      }
      for (let i = 1; i < edge.points.length; i += 1) {
        const a = edge.points[i - 1];
        const b = edge.points[i];
        if (!(a && b)) {
          continue;
        }
        if (!segmentHitsRect(a, b, node, 2)) {
          continue;
        }
        out.push({
          code: "workflow/edge-crosses-node",
          evidence: { nodeId: node.id },
          message: `Edge "${edge.id}" crosses unrelated node "${node.id}".`,
          severity: "error",
          subject: { edgeId: edge.id, nodeId: node.id },
          supportedFixes: [
            `Move "${node.id}" or an endpoint of "${edge.id}" to another col or lane.`,
          ],
        });
        break;
      }
    }
    const estimated = edge.label.length * 7;
    if (estimated > WORKFLOW_LABEL_MAX) {
      out.push({
        code: "workflow/label-width",
        message: `Edge "${edge.id}" label is wider than the measured slot.`,
        severity: "warning",
        subject: { edgeId: edge.id },
        supportedFixes: ["Shorten the action label while keeping the meaning."],
      });
    }
  }
  return out;
}

function mainPathKeys(spec: WorkflowSpec): {
  readonly hasPath: boolean;
  readonly pairs: ReadonlySet<string>;
} {
  const path = spec.mainPath;
  const pairs = new Set<string>();
  if (!(path && path.length >= 2)) {
    return { hasPath: false, pairs };
  }
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    if (from && to) {
      pairs.add(`${from}->${to}`);
    }
  }
  return { hasPath: true, pairs };
}

function edgeBottomY(
  nodes: readonly WorkflowNodeLayout[],
  edges: readonly { points: readonly WorkflowPoint[] }[]
): number {
  return Math.max(
    0,
    ...nodes.map((node) => node.y + node.h),
    ...edges.flatMap((edge) => edge.points.map((point) => point.y))
  );
}

export function compileWorkflowLayout(spec: WorkflowSpec): WorkflowLayout {
  const frames = placeWorkflowFrames(spec);
  const { groups, lanes, nodes, phases, width } = frames;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const path = mainPathKeys(spec);
  const pairCount = new Map<string, number>();
  const clusterCenterX =
    nodes.reduce((sum, node) => sum + node.x + node.w / 2, 0) /
    Math.max(1, nodes.length);
  const edges: WorkflowEdgeLayout[] = [];
  for (const edge of spec.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!(from && to)) {
      continue;
    }
    const role = workflowEdgeRole(edge.role);
    const pairKey = `${edge.from}->${edge.to}:${role}`;
    const offset = pairCount.get(pairKey) ?? 0;
    pairCount.set(pairKey, offset + 1);
    const laneFloor = Math.max(
      laneFloorFor(from, lanes),
      laneFloorFor(to, lanes)
    );
    const points = routeWorkflowEdge(
      from,
      to,
      edge.role,
      offset * 10,
      clusterCenterX,
      laneFloor,
      nodes,
      laneFor(from, lanes),
      laneFor(to, lanes)
    );
    const arrow = layoutEdgeArrow(
      points,
      WORKFLOW_ARROW_SIZE,
      WORKFLOW_ARROW_HALF,
      WORKFLOW_ARROW_GAP,
      WORKFLOW_ARROW_OVERLAP
    );
    const shaft = arrow?.stroke ?? points;
    edges.push({
      from: edge.from,
      id: edge.id,
      label: edge.label,
      labelAt: workflowLabelAt(
        shaft,
        nodes,
        lanes,
        groups,
        width,
        edge.label,
        shaft.at(-1)
      ),
      onMainPath: path.hasPath
        ? path.pairs.has(`${edge.from}->${edge.to}`)
        : role === "main",
      points,
      role,
      to: edge.to,
    });
  }
  const lastLane = lanes.at(-1);
  const legend = workflowLegendItems(nodes);
  const chrome = workflowBoardChrome(
    lastLane ? lastLane.y + lastLane.h : 0,
    edgeBottomY(nodes, edges),
    legend.length,
    spec.notes?.length ?? 0
  );
  return {
    diagnostics: [
      ...crossingDiagnostics(nodes, edges),
      ...layoutQualityDiagnostics(nodes, edges),
    ],
    edges,
    groups,
    height: chrome.height,
    lanes,
    legend,
    legendY: chrome.legendY,
    nodes,
    notes: spec.notes ?? [],
    notesY: chrome.notesY,
    phases,
    title: spec.title,
    width,
  };
}
