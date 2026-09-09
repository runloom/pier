import { layoutEdgeArrow } from "./geometry.ts";
import {
  WORKFLOW_ARROW_GAP,
  WORKFLOW_ARROW_HALF,
  WORKFLOW_ARROW_OVERLAP,
  WORKFLOW_ARROW_SIZE,
} from "./metrics.ts";
import type {
  WorkflowDiagnostic,
  WorkflowEdgeLayout,
  WorkflowNodeLayout,
  WorkflowPoint,
} from "./types.ts";

const MIN_LAST_SEGMENT = WORKFLOW_ARROW_GAP + WORKFLOW_ARROW_SIZE;
const LABEL_MAX_DIST = 10;
const VERTICAL_RUN = 24;

function insideNode(point: WorkflowPoint, node: WorkflowNodeLayout): boolean {
  return (
    point.x > node.x &&
    point.x < node.x + node.w &&
    point.y > node.y &&
    point.y < node.y + node.h
  );
}

function lastSegment(points: readonly WorkflowPoint[]): {
  a: WorkflowPoint;
  b: WorkflowPoint;
  len: number;
} | null {
  const b = points.at(-1);
  const a = points.at(-2);
  if (!(a && b)) {
    return null;
  }
  return { a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
}

function distToSegment(
  point: WorkflowPoint,
  a: WorkflowPoint,
  b: WorkflowPoint
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = Math.min(
    1,
    Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)
  );
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function pairKey(edge: WorkflowEdgeLayout): string {
  return [edge.from, edge.to].sort().join("|");
}

function longVerticalX(points: readonly WorkflowPoint[]): number | null {
  let best: { len: number; x: number } | null = null;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!(a && b) || Math.abs(a.x - b.x) >= 1) {
      continue;
    }
    const len = Math.abs(a.y - b.y);
    if (len <= VERTICAL_RUN) {
      continue;
    }
    if (!best || len > best.len) {
      best = { len, x: a.x };
    }
  }
  return best?.x ?? null;
}

function edgeError(
  code: string,
  edgeId: string,
  message: string,
  fix: string
): WorkflowDiagnostic {
  return {
    code,
    message,
    severity: "error",
    subject: { edgeId },
    supportedFixes: [fix],
  };
}

export function layoutQualityDiagnostics(
  nodes: readonly WorkflowNodeLayout[],
  edges: readonly WorkflowEdgeLayout[]
): WorkflowDiagnostic[] {
  const out: WorkflowDiagnostic[] = [];
  const verticalByPair = new Map<string, { edgeId: string; x: number }[]>();
  for (const edge of edges) {
    const last = lastSegment(edge.points);
    const moveFix = `Move an endpoint of "${edge.id}" to another col or lane.`;
    if (!last || last.len + 0.01 < MIN_LAST_SEGMENT) {
      out.push(
        edgeError(
          "workflow/last-segment-short",
          edge.id,
          `Edge "${edge.id}" last segment is too short for the arrow.`,
          moveFix
        )
      );
    }
    let nearest = Number.POSITIVE_INFINITY;
    for (let i = 1; i < edge.points.length; i += 1) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      if (!(a && b)) {
        continue;
      }
      nearest = Math.min(nearest, distToSegment(edge.labelAt, a, b));
    }
    if (edge.label.trim() !== "" && nearest > LABEL_MAX_DIST) {
      out.push(
        edgeError(
          "workflow/label-off-stroke",
          edge.id,
          `Edge "${edge.id}" label has drifted off the stroke.`,
          `Shorten the label on "${edge.id}", or move an endpoint to another col or lane.`
        )
      );
    }
    if (
      edge.label.trim() !== "" &&
      nodes.some((node) => insideNode(edge.labelAt, node))
    ) {
      out.push(
        edgeError(
          "workflow/label-inside-node",
          edge.id,
          `Edge "${edge.id}" label sits inside a node.`,
          `Shorten the label on "${edge.id}", or move an endpoint to another col or lane.`
        )
      );
    }
    const arrow = layoutEdgeArrow(
      edge.points,
      WORKFLOW_ARROW_SIZE,
      WORKFLOW_ARROW_HALF,
      WORKFLOW_ARROW_GAP,
      WORKFLOW_ARROW_OVERLAP
    );
    if (arrow) {
      for (const node of nodes) {
        if (insideNode(arrow.tip, node)) {
          out.push(
            edgeError(
              "workflow/arrow-inside-node",
              edge.id,
              `Edge "${edge.id}" arrow sits inside "${node.id}".`,
              moveFix
            )
          );
          break;
        }
      }
    } else {
      out.push(
        edgeError(
          "workflow/arrow-missing",
          edge.id,
          `Edge "${edge.id}" has no drawable arrow.`,
          moveFix
        )
      );
    }
    const x = longVerticalX(edge.points);
    if (x !== null) {
      const key = pairKey(edge);
      const list = verticalByPair.get(key) ?? [];
      list.push({ edgeId: edge.id, x });
      verticalByPair.set(key, list);
    }
  }
  for (const group of verticalByPair.values()) {
    for (let i = 1; i < group.length; i += 1) {
      const current = group[i];
      const clash = group.find(
        (item, index) => index < i && Math.abs(item.x - current.x) < 1
      );
      if (current && clash) {
        out.push(
          edgeError(
            "workflow/stacked-verticals",
            current.edgeId,
            `Edges "${clash.edgeId}" and "${current.edgeId}" share a vertical corridor.`,
            `Move an endpoint of "${current.edgeId}" to another col or lane.`
          )
        );
      }
    }
  }
  return out;
}
