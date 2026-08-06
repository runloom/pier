import type { PanelFloatingPosition } from "@shared/contracts/panel-floating.ts";

/**
 * 浮层锚点。x 是 CSS `right`（距面板右缘的像素），y 是 CSS `top`。
 * right 锚定：内容变宽向左伸，右侧按钮不抖；width=0 首帧也不会把胶囊推出右缘外
 * （left 锚定 + 默认靠右时，测宽为 0 会把 left 放到 panel 右缘，内容溢出）。
 */
export interface FloatingPoint {
  x: number;
  y: number;
}

export interface FloatingRect extends FloatingPoint {
  height: number;
  width: number;
}

interface FloatingBounds {
  bottomReserved: number;
  height: number;
  inset: number;
  width: number;
}

function travel(bounds: FloatingBounds, item: FloatingRect) {
  return {
    x: Math.max(0, bounds.width - item.width - bounds.inset * 2),
    y: Math.max(
      0,
      bounds.height - bounds.bottomReserved - item.height - bounds.inset * 2
    ),
  };
}

/** 归一化 x=0 靠左、x=1 靠右 → CSS right。 */
export function pointFromNormalizedPosition(
  position: PanelFloatingPosition,
  bounds: FloatingBounds,
  item: FloatingRect
): FloatingPoint {
  const available = travel(bounds, item);
  return {
    x: bounds.inset + available.x * (1 - position.x),
    y: bounds.inset + available.y * position.y,
  };
}

export function normalizedPositionFromPoint(
  point: FloatingPoint,
  bounds: FloatingBounds,
  item: FloatingRect
): PanelFloatingPosition {
  const available = travel(bounds, item);
  return {
    x:
      available.x <= 0
        ? 0.5
        : Math.min(1, Math.max(0, 1 - (point.x - bounds.inset) / available.x)),
    y:
      available.y <= 0
        ? 0
        : Math.min(1, Math.max(0, (point.y - bounds.inset) / available.y)),
  };
}

export function clampFloatingPoint(
  point: FloatingPoint,
  bounds: FloatingBounds,
  item: FloatingRect
): FloatingPoint {
  const available = travel(bounds, item);
  return {
    x: Math.min(bounds.inset + available.x, Math.max(bounds.inset, point.x)),
    y: Math.min(bounds.inset + available.y, Math.max(bounds.inset, point.y)),
  };
}

/** right 锚点 → 面板局部 left（障碍物相交用；getBoundingClientRect 是 left 系）。 */
function leftFromRight(
  right: number,
  bounds: FloatingBounds,
  itemWidth: number
): number {
  return bounds.width - right - itemWidth;
}

function rightFromLeft(
  left: number,
  bounds: FloatingBounds,
  itemWidth: number
): number {
  return bounds.width - left - itemWidth;
}

function intersects(a: FloatingRect, b: FloatingRect, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

/**
 * 障碍物规避。`desired` / 返回值均为 right 锚点；障碍物 rect 为 left 坐标系。
 */
export function resolveFloatingObstacles(
  desired: FloatingPoint,
  bounds: FloatingBounds,
  item: FloatingRect,
  obstacles: readonly FloatingRect[],
  gap = 8
): FloatingPoint {
  const toLeftPoint = (point: FloatingPoint): FloatingPoint => ({
    x: leftFromRight(point.x, bounds, item.width),
    y: point.y,
  });
  const toRightPoint = (point: FloatingPoint): FloatingPoint => ({
    x: rightFromLeft(point.x, bounds, item.width),
    y: point.y,
  });

  let leftPoint = toLeftPoint(clampFloatingPoint(desired, bounds, item));
  const maxAttempts = Math.max(1, obstacles.length * 2);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const placed = { ...item, ...leftPoint };
    const obstacle = obstacles.find((candidate) =>
      intersects(placed, candidate, gap)
    );
    if (!obstacle) {
      return toRightPoint(leftPoint);
    }
    const leftDesired = toLeftPoint(desired);
    const candidates = [
      { x: obstacle.x - item.width - gap, y: leftPoint.y },
      { x: obstacle.x + obstacle.width + gap, y: leftPoint.y },
      { x: leftPoint.x, y: obstacle.y - item.height - gap },
      { x: leftPoint.x, y: obstacle.y + obstacle.height + gap },
    ]
      .map((candidate) =>
        toLeftPoint(clampFloatingPoint(toRightPoint(candidate), bounds, item))
      )
      .filter((candidate) =>
        obstacles.every(
          (other) => !intersects({ ...item, ...candidate }, other, gap)
        )
      )
      .sort(
        (a, b) =>
          (a.x - leftDesired.x) ** 2 +
          (a.y - leftDesired.y) ** 2 -
          ((b.x - leftDesired.x) ** 2 + (b.y - leftDesired.y) ** 2)
      );
    leftPoint = candidates[0] ?? leftPoint;
  }
  return toRightPoint(leftPoint);
}
