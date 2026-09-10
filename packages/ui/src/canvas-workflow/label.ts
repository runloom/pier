import { workflowLabelWidth } from "./metrics.ts";
import type {
  WorkflowGroupLayout,
  WorkflowLaneLayout,
  WorkflowNodeLayout,
  WorkflowPoint,
} from "./types.ts";

function pointHitsNode(
  point: WorkflowPoint,
  node: WorkflowNodeLayout,
  pad: number
): boolean {
  return (
    point.x > node.x - pad &&
    point.x < node.x + node.w + pad &&
    point.y > node.y - pad &&
    point.y < node.y + node.h + pad
  );
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

function borderClearance(
  point: WorkflowPoint,
  lanes: readonly WorkflowLaneLayout[],
  groups: readonly WorkflowGroupLayout[]
): number {
  let best = 80;
  for (const lane of lanes) {
    if (point.x < lane.x - 4 || point.x > lane.x + lane.w + 4) {
      continue;
    }
    best = Math.min(
      best,
      Math.abs(point.y - lane.y),
      Math.abs(point.y - (lane.y + lane.h))
    );
  }
  for (const group of groups) {
    if (point.x < group.x - 4 || point.x > group.x + group.w + 4) {
      continue;
    }
    best = Math.min(
      best,
      Math.abs(point.y - group.y),
      Math.abs(point.y - (group.y + group.h))
    );
  }
  return best;
}

function gutterBonus(
  point: WorkflowPoint,
  lanes: readonly WorkflowLaneLayout[]
): number {
  let bonus = 0;
  for (let i = 1; i < lanes.length; i += 1) {
    const above = lanes[i - 1];
    const below = lanes[i];
    if (!(above && below)) {
      continue;
    }
    if (point.x < below.x - 4 || point.x > below.x + below.w + 4) {
      continue;
    }
    const top = above.y + above.h + 4;
    const bottom = below.y - 4;
    if (point.y > top && point.y < bottom) {
      bonus += 80;
    }
  }
  return bonus;
}

function openAirBonus(
  point: WorkflowPoint,
  groups: readonly WorkflowGroupLayout[]
): number {
  const under = groups.some(
    (group) => point.x >= group.x && point.x <= group.x + group.w
  );
  return under ? 0 : 30;
}

function keepOffDart(
  picked: WorkflowPoint,
  dartBase: WorkflowPoint,
  halfW: number,
  nodes: readonly WorkflowNodeLayout[]
): WorkflowPoint {
  const pad = 4 + halfW;
  const alongX =
    Math.abs(dartBase.x - picked.x) >= Math.abs(dartBase.y - picked.y);
  let next = picked;
  if (alongX && picked.x <= dartBase.x) {
    next = { x: Math.min(picked.x, dartBase.x - pad), y: picked.y };
  } else if (alongX) {
    next = { x: Math.max(picked.x, dartBase.x + pad), y: picked.y };
  } else if (picked.y <= dartBase.y) {
    next = { x: picked.x, y: Math.min(picked.y, dartBase.y - pad) };
  } else {
    next = { x: picked.x, y: Math.max(picked.y, dartBase.y + pad) };
  }
  if (nodes.some((node) => pointHitsNode(next, node, 0))) {
    return picked;
  }
  return next;
}

function boxHitsNode(
  x: number,
  y: number,
  w: number,
  h: number,
  node: WorkflowNodeLayout,
  pad: number
): boolean {
  return !(
    x + w + pad < node.x ||
    node.x + node.w + pad < x ||
    y + h + pad < node.y ||
    node.y + node.h + pad < y
  );
}

/** Shaft anchor for quality; the pill paints beside this point. */
export function workflowLabelAt(
  points: readonly WorkflowPoint[],
  nodes: readonly WorkflowNodeLayout[],
  lanes: readonly WorkflowLaneLayout[],
  groups: readonly WorkflowGroupLayout[],
  boardWidth: number,
  label = "",
  dartBase?: WorkflowPoint
): WorkflowPoint {
  const clamp = (point: WorkflowPoint): WorkflowPoint => ({
    x: Math.min(boardWidth - 36, Math.max(36, point.x)),
    y: Math.max(18, point.y),
  });
  const steps = 11;
  let picked = points[0] ?? { x: 0, y: 0 };
  let pickedScore = Number.NEGATIVE_INFINITY;
  const minRun = 40;
  let longest = minRun;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) {
      longest = Math.max(longest, Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  const runFloor = Math.max(minRun, longest * 0.55);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!(a && b)) {
      continue;
    }
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < runFloor) {
      continue;
    }
    for (let step = 2; step <= steps - 2; step += 1) {
      const t = step / steps;
      const point = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      };
      if (nodes.some((node) => pointHitsNode(point, node, 8))) {
        continue;
      }
      const clear = borderClearance(point, lanes, groups);
      const score =
        (clear < 14 ? clear - 80 : clear) +
        gutterBonus(point, lanes) +
        openAirBonus(point, groups) +
        (1 - Math.abs(t - 0.5)) * 20 +
        len * 0.08;
      if (score > pickedScore) {
        picked = point;
        pickedScore = score;
      }
    }
  }
  if (dartBase && label.trim() !== "") {
    picked = keepOffDart(
      picked,
      dartBase,
      workflowLabelWidth(label) / 2,
      nodes
    );
  }
  return clamp(picked);
}

export function workflowLabelPaintBox(
  points: readonly WorkflowPoint[],
  labelAt: WorkflowPoint,
  labelW: number,
  pill: number,
  nodes: readonly WorkflowNodeLayout[],
  gap: number
): { x: number; y: number } {
  let bestA = points[0] ?? labelAt;
  let bestB = points[1] ?? labelAt;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!(a && b)) {
      continue;
    }
    const dist = distToSegment(labelAt, a, b);
    if (dist < bestD) {
      bestD = dist;
      bestA = a;
      bestB = b;
    }
  }
  const horizontal = Math.abs(bestB.x - bestA.x) >= Math.abs(bestB.y - bestA.y);
  if (horizontal) {
    const above = {
      x: labelAt.x - labelW / 2,
      y: labelAt.y - pill - gap,
    };
    const below = { x: labelAt.x - labelW / 2, y: labelAt.y + gap };
    const aboveHits = nodes.some((node) =>
      boxHitsNode(above.x, above.y, labelW, pill, node, 8)
    );
    const belowHits = nodes.some((node) =>
      boxHitsNode(below.x, below.y, labelW, pill, node, 8)
    );
    if (!aboveHits) {
      return above;
    }
    if (!belowHits) {
      return below;
    }
    return above;
  }
  const candidates = [
    { x: labelAt.x + gap, y: labelAt.y - pill / 2 },
    { x: labelAt.x - labelW - gap, y: labelAt.y - pill / 2 },
  ];
  const open = candidates.find(
    (box) =>
      !nodes.some((node) => boxHitsNode(box.x, box.y, labelW, pill, node, 8))
  );
  return (
    open ?? candidates[0] ?? { x: labelAt.x + gap, y: labelAt.y - pill / 2 }
  );
}
