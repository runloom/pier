import type { WorkflowPoint } from "./types.ts";

/** Shorten the last segment so a marker sits outside the node box. */
export function insetTerminal(
  points: readonly WorkflowPoint[],
  gap: number
): WorkflowPoint[] {
  if (points.length < 2 || gap <= 0) {
    return [...points];
  }
  const last = points.at(-1);
  const prev = points.at(-2);
  if (!(last && prev)) {
    return [...points];
  }
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1) {
    return [...points];
  }
  const pull = Math.min(gap, len - 1);
  const scale = (len - pull) / len;
  return [
    ...points.slice(0, -1),
    { x: prev.x + dx * scale, y: prev.y + dy * scale },
  ];
}

export function pointsAttr(points: readonly WorkflowPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function longestSegment(points: readonly WorkflowPoint[]): number {
  let best = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!(a && b)) {
      continue;
    }
    best = Math.max(best, Math.hypot(b.x - a.x, b.y - a.y));
  }
  return best;
}

export interface WorkflowArrowLayout {
  readonly head: readonly WorkflowPoint[];
  readonly stroke: readonly WorkflowPoint[];
  readonly tip: WorkflowPoint;
}

/** Dart sits on the node port; the card paints above the last pixel. */
export function layoutEdgeArrow(
  points: readonly WorkflowPoint[],
  size: number,
  half: number,
  gap: number,
  overlap: number
): WorkflowArrowLayout | null {
  const towardTip = insetTerminal(points, gap);
  if (towardTip.length < 2) {
    return null;
  }
  const tip = towardTip.at(-1);
  const prev = towardTip.at(-2);
  if (!(tip && prev)) {
    return null;
  }
  const dx = tip.x - prev.x;
  const dy = tip.y - prev.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) {
    return null;
  }
  const ux = dx / len;
  const uy = dy / len;
  const backX = tip.x - ux * size;
  const backY = tip.y - uy * size;
  return {
    head: [
      tip,
      { x: backX - uy * half, y: backY + ux * half },
      { x: backX + uy * half, y: backY - ux * half },
    ],
    stroke: insetTerminal(towardTip, Math.max(0, size - overlap)),
    tip,
  };
}
