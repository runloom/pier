import { describe, expect, it } from "vitest";
import {
  clampFloatingPoint,
  normalizedPositionFromPoint,
  pointFromNormalizedPosition,
  resolveFloatingObstacles,
} from "@/panel-kits/terminal/terminal-floating-geometry.ts";

const bounds = {
  bottomReserved: 28,
  height: 300,
  inset: 8,
  width: 500,
};
const item = { height: 32, width: 180, x: 0, y: 0 };

describe("terminal floating geometry", () => {
  it("round-trips normalized panel-local positions", () => {
    const position = { x: 0.37, y: 0.62 };
    const point = pointFromNormalizedPosition(position, bounds, item);

    expect(normalizedPositionFromPoint(point, bounds, item)).toEqual(position);
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
    const point = resolveFloatingObstacles({ x: 300, y: 12 }, bounds, item, [
      { height: 40, width: 120, x: 360, y: 8 },
      { height: 40, width: 120, x: 360, y: 56 },
    ]);

    expect(point.x).toBeLessThanOrEqual(172);
    expect(point.y).toBe(12);
  });
});
