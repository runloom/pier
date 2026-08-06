import { describe, expect, it } from "vitest";
import {
  clampFloatingPoint,
  normalizedPositionFromPoint,
  pointFromNormalizedPosition,
  resolveFloatingObstacles,
} from "@/panel-kits/terminal/floating-geometry.ts";

const bounds = {
  bottomReserved: 28,
  height: 300,
  inset: 8,
  width: 500,
};
const item = { height: 32, width: 180, x: 0, y: 0 };

describe("terminal floating geometry", () => {
  it("round-trips normalized panel-local positions (right-anchored)", () => {
    const position = { x: 0.37, y: 0.62 };
    const point = pointFromNormalizedPosition(position, bounds, item);

    expect(normalizedPositionFromPoint(point, bounds, item)).toEqual(position);
  });

  it("maps normalized x=1 to right inset and x=0 to the left travel end", () => {
    // available.x = 500 - 180 - 16 = 304
    // x=1 靠右 → right = inset = 8
    expect(pointFromNormalizedPosition({ x: 1, y: 0 }, bounds, item).x).toBe(8);
    // x=0 靠左 → right = 8 + 304 = 312
    expect(pointFromNormalizedPosition({ x: 0, y: 0 }, bounds, item).x).toBe(
      312
    );
    // center: 8 + 304 * 0.5 = 160
    expect(pointFromNormalizedPosition({ x: 0.5, y: 0 }, bounds, item).x).toBe(
      160
    );
  });

  it("clamps the control inside the terminal panel and above its status bar", () => {
    expect(clampFloatingPoint({ x: 999, y: 999 }, bounds, item)).toEqual({
      x: 312,
      y: 232,
    });
    expect(clampFloatingPoint({ x: -20, y: -20 }, bounds, item)).toEqual({
      x: 8,
      y: 8,
    });
  });

  it("avoids all utility-slot obstacles when a free candidate exists", () => {
    // desired right=100 → left = 500 - 100 - 180 = 220
    const point = resolveFloatingObstacles({ x: 100, y: 12 }, bounds, item, [
      { height: 40, width: 120, x: 360, y: 8 },
      { height: 40, width: 120, x: 360, y: 56 },
    ]);

    const left = bounds.width - point.x - item.width;
    expect(left + item.width).toBeLessThanOrEqual(360 - 8 + 0.001);
    expect(point.y).toBe(12);
  });

  it("keeps right-anchored control fully inside panel bounds", () => {
    for (const nx of [0, 0.5, 1] as const) {
      const point = pointFromNormalizedPosition({ x: nx, y: 0 }, bounds, item);
      const left = bounds.width - point.x - item.width;
      expect(left).toBeGreaterThanOrEqual(bounds.inset - 0.001);
      expect(left + item.width).toBeLessThanOrEqual(
        bounds.width - bounds.inset + 0.001
      );
      expect(point.x).toBeGreaterThanOrEqual(bounds.inset - 0.001);
    }
  });

  it("default top-right (x=1) keeps right edge at inset even when width is 0", () => {
    // left 锚定在 width=0 时会把 left 放到 panel 右缘导致溢出；right 锚定不会。
    const zeroWidth = { height: 32, width: 0, x: 0, y: 0 };
    const point = pointFromNormalizedPosition(
      { x: 1, y: 0 },
      bounds,
      zeroWidth
    );
    expect(point.x).toBe(bounds.inset);
  });
});
