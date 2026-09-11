import {
  isScreenFlowFrame,
  SCREEN_FLOW_PORT_CONTENT,
  SCREEN_FLOW_PORT_RETURN,
  SCREEN_FLOW_PORT_ROW,
  SCREEN_FLOW_RETURN_SIDE,
  WORKFLOW_LANE_GUTTER,
  WORKFLOW_RETURN_GAP,
  WORKFLOW_RETURN_SIDE,
  WORKFLOW_STUB,
} from "./metrics.ts";
import { workflowEdgeRole } from "./role.ts";
import type {
  WorkflowEdge,
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
    if (to.y > from.y && isScreenFlowFrame(to)) {
      return {
        from: "bottom",
        to: to.x + to.w / 2 >= from.x + from.w / 2 ? "left" : "right",
      };
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
  if (isScreenFlowFrame(from) || isScreenFlowFrame(to)) {
    const side: WorkflowSide = from.x <= to.x ? "right" : "left";
    return { from: side, to: side };
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

function channelBlocked(
  x: number,
  from: WorkflowNodeLayout,
  to: WorkflowNodeLayout,
  nodes: readonly WorkflowNodeLayout[]
): boolean {
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y + from.h, to.y + to.h);
  return nodes.some((node) => {
    if (node.id === from.id || node.id === to.id) {
      return false;
    }
    if (x < node.x - 8 || x > node.x + node.w + 8) {
      return false;
    }
    return !(node.y + node.h < top || node.y > bottom);
  });
}

function sideChannelX(
  from: WorkflowNodeLayout,
  to: WorkflowNodeLayout,
  channelOffset: number,
  clusterCenterX: number,
  nodes: readonly WorkflowNodeLayout[]
): number {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x + from.w, to.x + to.w);
  const large = isScreenFlowFrame(from) || isScreenFlowFrame(to);
  const base = large ? SCREEN_FLOW_RETURN_SIDE : WORKFLOW_RETURN_SIDE;
  let offset = base + channelOffset * 10;
  for (let step = 0; step < 4; step += 1) {
    const leftX = left - offset;
    const rightX = right + offset;
    const leftHit = channelBlocked(leftX, from, to, nodes);
    const rightHit = channelBlocked(rightX, from, to, nodes);
    if (!leftHit && rightHit) {
      return leftX;
    }
    if (!rightHit && leftHit) {
      return rightX;
    }
    if (!(leftHit && rightHit)) {
      const mid = left / 2 + right / 2;
      if (mid >= clusterCenterX) {
        return rightX;
      }
      if (leftX >= WORKFLOW_LANE_GUTTER - 8) {
        return leftX;
      }
      return rightX;
    }
    offset += 20;
  }
  const fallback = base + channelOffset * 10;
  const mid = left / 2 + right / 2;
  return mid >= clusterCenterX ? right + fallback : left - fallback;
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
  clusterCenterX: number,
  nodes: readonly WorkflowNodeLayout[]
): WorkflowPoint[] {
  const sideX = sideChannelX(from, to, channelOffset, clusterCenterX, nodes);
  const side: WorkflowSide = sideX < from.x ? "left" : "right";
  const fromT = isScreenFlowFrame(from) ? SCREEN_FLOW_PORT_CONTENT : 0.5;
  const toT = isScreenFlowFrame(to) ? SCREEN_FLOW_PORT_RETURN : 0.82;
  const start = portAlong(from, side, fromT);
  const end = portAlong(to, side, toT);
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
  if (Math.abs(a.y - b.y) < 1) {
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

function sidePort(
  node: WorkflowNodeLayout,
  side: WorkflowSide,
  along: number
): WorkflowPoint {
  if (side === "left" || side === "right") {
    return portAlong(node, side, along);
  }
  return port(node, side);
}

function routeL(
  from: WorkflowNodeLayout,
  to: WorkflowNodeLayout,
  sides: { from: WorkflowSide; to: WorkflowSide },
  nodes: readonly WorkflowNodeLayout[],
  fromLane: WorkflowLaneLayout | undefined,
  toLane: WorkflowLaneLayout | undefined,
  toAlong = 0.5,
  fromAlong = 0.5
): WorkflowPoint[] {
  const start = sidePort(from, sides.from, fromAlong);
  const end = sidePort(to, sides.to, toAlong);
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
  const preferGutter =
    toLane?.variant === "exception" &&
    fromLane !== undefined &&
    toLane.y > fromLane.y + fromLane.h;
  let via = verticalFirst;
  if (blocked(verticalFirst) || (preferGutter && !blocked(horizontalFirst))) {
    via = horizontalFirst;
  }
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
    return routeSameColumnReturn(
      from,
      to,
      channelOffset,
      clusterCenterX,
      nodes
    );
  }
  if (
    !self &&
    resolved === "error" &&
    isScreenFlowFrame(to) &&
    to.y > from.y + from.h - 8
  ) {
    const returnX = sideChannelX(
      from,
      to,
      channelOffset,
      clusterCenterX,
      nodes
    );
    const side: WorkflowSide = returnX > to.x ? "left" : "right";
    return routeL(
      from,
      to,
      { from: "bottom", to: side },
      nodes,
      fromLane,
      toLane,
      SCREEN_FLOW_PORT_CONTENT
    );
  }
  const sides = inferSides(from, to, role, self);
  const rowAlong =
    isScreenFlowFrame(from) && isScreenFlowFrame(to) && sameBand(from, to)
      ? SCREEN_FLOW_PORT_ROW
      : 0.5;
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
  return routeL(from, to, sides, nodes, fromLane, toLane, rowAlong, rowAlong);
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
