/**
 * 几何挑选 focus 目标 — 在指定方向上挑出与 active group 最近的邻居.
 *
 * 算法 (照搬 loomdesk workspace-host.svelte.ts:3227-3280):
 *   - inDir: 候选 rect 必须在 active 指定方向"足够远" (容忍 tolPx 像素 gap)
 *   - overlap: 方向垂直轴上的投影重叠长度 (横向 focus 看 y 重叠, 纵向看 x)
 *   - dist: 中心距离, 重叠平分时作 tie-breaker
 *
 * 返回 candidates 数组里的 index, 或 null (无候选). isActive 的候选跳过.
 */
export interface GroupCandidate {
  id: string;
  isActive: boolean;
  rect: DOMRect | null;
}

export type FocusDirection = "right" | "down" | "left" | "up";

/** 候选 rect 是否在 active 的指定方向"足够远" (容忍 tolPx gap). */
function isInDirection(
  candidate: DOMRect,
  active: DOMRect,
  direction: FocusDirection,
  tolPx: number
): boolean {
  if (direction === "up") {
    return candidate.bottom <= active.top + tolPx;
  }
  if (direction === "down") {
    return candidate.top >= active.bottom - tolPx;
  }
  if (direction === "left") {
    return candidate.right <= active.left + tolPx;
  }
  return candidate.left >= active.right - tolPx;
}

/** 方向垂直轴上的投影重叠长度. 横向 focus 看 y, 纵向看 x. */
function projectionOverlap(
  candidate: DOMRect,
  active: DOMRect,
  isVert: boolean
): number {
  if (isVert) {
    return Math.max(
      0,
      Math.min(active.right, candidate.right) -
        Math.max(active.left, candidate.left)
    );
  }
  return Math.max(
    0,
    Math.min(active.bottom, candidate.bottom) -
      Math.max(active.top, candidate.top)
  );
}

/** 中心距离 (重叠平分时作 tie-breaker). */
function centerDistance(
  candidate: DOMRect,
  active: DOMRect,
  isVert: boolean
): number {
  if (isVert) {
    return Math.abs(
      candidate.top + candidate.height / 2 - (active.top + active.height / 2)
    );
  }
  return Math.abs(
    candidate.left + candidate.width / 2 - (active.left + active.width / 2)
  );
}

export function pickFocusTarget(
  activeRect: DOMRect,
  candidates: readonly GroupCandidate[],
  direction: FocusDirection,
  tolPx: number
): number | null {
  const isVert = direction === "up" || direction === "down";
  let bestOverlap = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestIdx: number | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c || c.isActive || !c.rect) {
      continue;
    }
    if (!isInDirection(c.rect, activeRect, direction, tolPx)) {
      continue;
    }

    const overlap = projectionOverlap(c.rect, activeRect, isVert);
    const dist = centerDistance(c.rect, activeRect, isVert);

    if (overlap > bestOverlap || (overlap === bestOverlap && dist < bestDist)) {
      bestOverlap = overlap;
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}
