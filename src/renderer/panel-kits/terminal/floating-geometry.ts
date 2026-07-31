import type { PanelFloatingPosition } from "@shared/contracts/panel-floating.ts";

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

export function pointFromNormalizedPosition(
  position: PanelFloatingPosition,
  bounds: FloatingBounds,
  item: FloatingRect
): FloatingPoint {
  const available = travel(bounds, item);
  return {
    x: bounds.inset + available.x * position.x,
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
        : Math.min(1, Math.max(0, (point.x - bounds.inset) / available.x)),
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

function intersects(a: FloatingRect, b: FloatingRect, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

export function resolveFloatingObstacles(
  desired: FloatingPoint,
  bounds: FloatingBounds,
  item: FloatingRect,
  obstacles: readonly FloatingRect[],
  gap = 8
): FloatingPoint {
  let point = clampFloatingPoint(desired, bounds, item);
  const maxAttempts = Math.max(1, obstacles.length * 2);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const obstacle = obstacles.find((candidate) =>
      intersects({ ...item, ...point }, candidate, gap)
    );
    if (!obstacle) {
      return point;
    }
    const candidates = [
      { x: obstacle.x - item.width - gap, y: point.y },
      { x: obstacle.x + obstacle.width + gap, y: point.y },
      { x: point.x, y: obstacle.y - item.height - gap },
      { x: point.x, y: obstacle.y + obstacle.height + gap },
    ]
      .map((candidate) => clampFloatingPoint(candidate, bounds, item))
      .filter((candidate) =>
        obstacles.every(
          (other) => !intersects({ ...item, ...candidate }, other, gap)
        )
      )
      .sort(
        (a, b) =>
          (a.x - desired.x) ** 2 +
          (a.y - desired.y) ** 2 -
          ((b.x - desired.x) ** 2 + (b.y - desired.y) ** 2)
      );
    point = candidates[0] ?? point;
  }
  return point;
}
