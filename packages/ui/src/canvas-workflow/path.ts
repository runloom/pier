import {
  WORKFLOW_LANE_GUTTER,
  WORKFLOW_RETURN_GAP,
  WORKFLOW_RETURN_SIDE,
  WORKFLOW_STUB,
  workflowLabelWidth,
} from "./metrics.ts";
import { workflowEdgeRole } from "./role.ts";
import type {
  WorkflowEdge,
  WorkflowGroupLayout,
  WorkflowLaneLayout,
  WorkflowNodeLayout,
  WorkflowPoint,
  WorkflowSide,
} from "./types.ts";

function port(node: WorkflowNodeLayout, side: WorkflowSide): WorkflowPoint {
  switch (side) {
    case "left":
      return { x: node.x, y: node.y + node.h / 2 };
    case "right":
      return { x: node.x + node.w, y: node.y + node.h / 2 };
    case "top":
      return { x: node.x + node.w / 2, y: node.y };
    default:
      return { x: node.x + node.w / 2, y: node.y + node.h };
  }
}

function stub(point: WorkflowPoint, side: WorkflowSide): WorkflowPoint {
  switch (side) {
    case "left":
      return { x: point.x - WORKFLOW_STUB, y: point.y };
    case "right":
      return { x: point.x + WORKFLOW_STUB, y: point.y };
    case "top":
      return { x: point.x, y: point.y - WORKFLOW_STUB };
    default:
      return { x: point.x, y: point.y + WORKFLOW_STUB };
  }
}

function sameColumn(from: WorkflowNodeLayout, to: WorkflowNodeLayout): boolean {
  return Math.abs(from.x - to.x) < 8;
}

function sameBand(from: WorkflowNodeLayout, to: WorkflowNodeLayout): boolean {
  return Math.abs(to.y - from.y) < Math.max(from.h, to.h);
}

function inferSides(
  from: WorkflowNodeLayout,
  to: WorkflowNodeLayout,
  role: WorkflowEdge["role"],
  self: boolean
): { from: WorkflowSide; to: WorkflowSide } {
  if (self) {
    return { from: "right", to: "bottom" };
  }
  const resolved = workflowEdgeRole(role);
  if (resolved === "return") {
    return { from: "bottom", to: "bottom" };
  }
  if (resolved === "error") {
    if (to.x >= from.x + from.w - 1 && sameBand(from, to)) {
      return { from: "bottom", to: "bottom" };
    }
    return { from: "bottom", to: to.y > from.y ? "top" : "left" };
  }
  if (to.y >= from.y + from.h - 1) {
    return {
      from: "bottom",
      to: to.x + to.w / 2 >= from.x + from.w / 2 ? "left" : "right",
    };
  }
  if (to.x >= from.x + from.w - 1) {
    return { from: "right", to: "left" };
  }
  if (to.x + to.w <= from.x + 1) {
    if (sameBand(from, to)) {
      return { from: "bottom", to: "bottom" };
    }
    return { from: "left", to: "right" };
  }
  return { from: "top", to: "bottom" };
}

function append(points: WorkflowPoint[], point: WorkflowPoint) {
  const last = points.at(-1);
  if (last && last.x === point.x && last.y === point.y) {
    return;
  }
  points.push(point);
}

function sideChannelX(
  from: WorkflowNodeLayout,
  to: WorkflowNodeLayout,
  channelOffset: number,
  clusterCenterX: number
): number {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x + from.w, to.x + to.w);
  const offset = WORKFLOW_RETURN_SIDE + channelOffset * 10;
  const mid = left / 2 + right / 2;
  if (mid >= clusterCenterX) {
    return right + offset;
  }
  if (left - offset >= WORKFLOW_LANE_GUTTER - 8) {
    return left - offset;
  }
  return right + offset;
}

function portAlong(
  node: WorkflowNodeLayout,
  side: WorkflowSide,
  along: number
): WorkflowPoint {
  const t = Math.min(1, Math.max(0, along));
  switch (side) {
    case "left":
      return { x: node.x, y: node.y + node.h * t };
    case "right":
      return { x: node.x + node.w, y: node.y + node.h * t };
    case "top":
      return { x: node.x + node.w * t, y: node.y };
    default:
      return { x: node.x + node.w * t, y: node.y + node.h };
  }
}

function routeSameColumnReturn(
  from: WorkflowNodeLayout,
  to: WorkflowNodeLayout,
  channelOffset: number,
  clusterCenterX: number
): WorkflowPoint[] {
  const sideX = sideChannelX(from, to, channelOffset, clusterCenterX);
  const side: WorkflowSide = sideX < from.x ? "left" : "right";
  const start = portAlong(from, side, 0.5);
  const end = portAlong(to, side, 0.82);
  const points: WorkflowPoint[] = [];
  append(points, start);
  append(points, { x: sideX, y: start.y });
  append(points, { x: sideX, y: end.y });
  append(points, end);
  return points;
}

export function segmentHitsRect(
  a: WorkflowPoint,
  b: WorkflowPoint,
  rect: WorkflowNodeLayout,
  pad: number
): boolean {
  const minX = rect.x - pad;
  const minY = rect.y - pad;
  const maxX = rect.x + rect.w + pad;
  const maxY = rect.y + rect.h + pad;
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  if (right < minX || left > maxX || bottom < minY || top > maxY) {
    return false;
  }
  if (a.y === b.y) {
    return a.y > minY && a.y < maxY && right > minX && left < maxX;
  }
  return a.x > minX && a.x < maxX && bottom > minY && top < maxY;
}

function hitsOther(
  a: WorkflowPoint,
  b: WorkflowPoint,
  from: WorkflowNodeLayout,
  to: WorkflowNodeLayout,
  nodes: readonly WorkflowNodeLayout[]
): boolean {
  return nodes.some(
    (node) =>
      node.id !== from.id && node.id !== to.id && segmentHitsRect(a, b, node, 2)
  );
}

function routeFloor(
  from: WorkflowNodeLayout,
  to: WorkflowNodeLayout,
  channelOffset: number,
  laneFloor: number
): WorkflowPoint[] {
  const start = port(from, "bottom");
  const end = port(to, "bottom");
  const startStub = stub(start, "bottom");
  const endStub = stub(end, "bottom");
  let channelY =
    Math.max(from.y + from.h, to.y + to.h) +
    WORKFLOW_RETURN_GAP +
    channelOffset;
  if (from.x > to.x + to.w + 8) {
    channelY = Math.max(channelY, laneFloor + WORKFLOW_RETURN_GAP + 24);
  } else {
    channelY += 10;
  }
  const points: WorkflowPoint[] = [];
  append(points, start);
  append(points, startStub);
  append(points, { x: start.x, y: channelY });
  append(points, { x: end.x, y: channelY });
  append(points, endStub);
  append(points, end);
  return points;
}

function routeL(
  from: WorkflowNodeLayout,
  to: WorkflowNodeLayout,
  sides: { from: WorkflowSide; to: WorkflowSide },
  nodes: readonly WorkflowNodeLayout[],
  fromLane: WorkflowLaneLayout | undefined,
  toLane: WorkflowLaneLayout | undefined
): WorkflowPoint[] {
  const start = port(from, sides.from);
  const end = port(to, sides.to);
  const points: WorkflowPoint[] = [];
  if (
    Math.abs(start.y - end.y) < 1 &&
    Math.abs(start.x - end.x) > WORKFLOW_STUB
  ) {
    append(points, start);
    append(points, end);
    return points;
  }
  let startStub = stub(start, sides.from);
  const endStub = stub(end, sides.to);
  if (
    sides.from === "bottom" &&
    toLane?.variant === "exception" &&
    fromLane &&
    toLane.y > fromLane.y + fromLane.h
  ) {
    const gutterY = (fromLane.y + fromLane.h + toLane.y) / 2;
    if (gutterY > start.y + 12) {
      startStub = { x: start.x, y: gutterY };
    }
  }
  append(points, start);
  append(points, startStub);
  if (Math.abs(startStub.x - endStub.x) < 1) {
    append(points, endStub);
    append(points, end);
    return points;
  }
  if (Math.abs(startStub.y - endStub.y) < 1) {
    append(points, endStub);
    append(points, end);
    return points;
  }
  const verticalFirst = { x: startStub.x, y: endStub.y };
  const horizontalFirst = { x: endStub.x, y: startStub.y };
  const blocked = (via: WorkflowPoint): boolean =>
    hitsOther(startStub, via, from, to, nodes) ||
    hitsOther(via, endStub, from, to, nodes) ||
    segmentHitsRect(startStub, via, to, 2) ||
    segmentHitsRect(via, endStub, to, 2);
  const via = blocked(verticalFirst) ? horizontalFirst : verticalFirst;
  append(points, via);
  append(points, endStub);
  append(points, end);
  return points;
}

export function routeWorkflowEdge(
  from: WorkflowNodeLayout,
  to: WorkflowNodeLayout,
  role: WorkflowEdge["role"],
  channelOffset: number,
  clusterCenterX: number,
  laneFloor: number,
  nodes: readonly WorkflowNodeLayout[],
  fromLane?: WorkflowLaneLayout,
  toLane?: WorkflowLaneLayout
): WorkflowPoint[] {
  const self = from.id === to.id;
  const resolved = workflowEdgeRole(role);
  if (!self && resolved === "return" && sameColumn(from, to)) {
    return routeSameColumnReturn(from, to, channelOffset, clusterCenterX);
  }
  const sides = inferSides(from, to, role, self);
  if (self) {
    const start = port(from, sides.from);
    const end = port(to, sides.to);
    const startStub = stub(start, sides.from);
    const endStub = stub(end, sides.to);
    const points: WorkflowPoint[] = [];
    append(points, start);
    append(points, startStub);
    append(points, { x: startStub.x + 24, y: startStub.y });
    append(points, { x: startStub.x + 24, y: endStub.y + 20 });
    append(points, { x: endStub.x, y: endStub.y + 20 });
    append(points, endStub);
    append(points, end);
    return points;
  }
  if (sides.from === "bottom" && sides.to === "bottom") {
    return routeFloor(from, to, channelOffset, laneFloor);
  }
  return routeL(from, to, sides, nodes, fromLane, toLane);
}

export function laneFor(
  node: WorkflowNodeLayout,
  lanes: readonly WorkflowLaneLayout[]
): WorkflowLaneLayout | undefined {
  return lanes.find(
    (item) => node.y >= item.y - 1 && node.y <= item.y + item.h + 1
  );
}

export function laneFloorFor(
  node: WorkflowNodeLayout,
  lanes: readonly WorkflowLaneLayout[]
): number {
  const lane = laneFor(node, lanes);
  return lane ? lane.y + lane.h : node.y + node.h;
}

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

export function workflowLabelAt(
  points: readonly WorkflowPoint[],
  nodes: readonly WorkflowNodeLayout[],
  lanes: readonly WorkflowLaneLayout[],
  groups: readonly WorkflowGroupLayout[],
  boardWidth: number,
  label = "",
  dartBase?: WorkflowPoint
): WorkflowPoint {
  let bestA = points[0] ?? { x: 0, y: 0 };
  let bestB = bestA;
  let bestLen = -1;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!(a && b)) {
      continue;
    }
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > bestLen) {
      bestLen = len;
      bestA = a;
      bestB = b;
    }
  }
  const clamp = (point: WorkflowPoint): WorkflowPoint => ({
    x: Math.min(boardWidth - 36, Math.max(36, point.x)),
    y: Math.max(18, point.y),
  });
  const steps = 11;
  let picked = {
    x: bestA.x / 2 + bestB.x / 2,
    y: bestA.y / 2 + bestB.y / 2,
  };
  let pickedScore = Number.NEGATIVE_INFINITY;
  let pickedT = 0.5;
  for (let step = 2; step <= steps - 2; step += 1) {
    const t = step / steps;
    const point = {
      x: bestA.x + (bestB.x - bestA.x) * t,
      y: bestA.y + (bestB.y - bestA.y) * t,
    };
    if (nodes.some((node) => pointHitsNode(point, node, 8))) {
      continue;
    }
    const score =
      borderClearance(point, lanes, groups) +
      gutterBonus(point, lanes) +
      openAirBonus(point, groups) +
      (1 - Math.abs(t - 0.5)) * 20;
    if (
      score > pickedScore ||
      (score === pickedScore && Math.abs(t - 0.5) < Math.abs(pickedT - 0.5))
    ) {
      picked = point;
      pickedScore = score;
      pickedT = t;
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
