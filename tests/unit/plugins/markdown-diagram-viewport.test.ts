import { describe, expect, it, vi } from "vitest";
import {
  computeNaturalCappedSize,
  contentBoxWidthPx,
  parseSvgIntrinsicSize,
} from "../../../src/plugins/builtin/files/renderer/markdown/diagram-viewport.ts";

describe("parseSvgIntrinsicSize", () => {
  it("reads viewBox dimensions", () => {
    expect(
      parseSvgIntrinsicSize(
        '<svg viewBox="0 0 420 1800" xmlns="http://www.w3.org/2000/svg"></svg>'
      )
    ).toEqual({ height: 1800, width: 420 });
  });

  it("falls back to width/height attributes", () => {
    expect(
      parseSvgIntrinsicSize(
        '<svg width="300px" height="120" xmlns="http://www.w3.org/2000/svg"></svg>'
      )
    ).toEqual({ height: 120, width: 300 });
  });
});

describe("computeNaturalCappedSize", () => {
  it("never scales up a narrow diagram to fill a wide column", () => {
    const size = computeNaturalCappedSize({ width: 420, height: 1800 }, 960, 1);
    expect(size).toEqual({ width: 420, height: 1800 });
  });

  it("scales down only when wider than the container", () => {
    const size = computeNaturalCappedSize({ width: 1200, height: 200 }, 600, 1);
    expect(size.width).toBe(600);
    expect(size.height).toBeCloseTo(100);
  });

  it("applies zoom without exceeding the width cap", () => {
    const size = computeNaturalCappedSize({ width: 400, height: 200 }, 500, 2);
    // 400*2 = 800 > 500 → cap
    expect(size.width).toBe(500);
    expect(size.height).toBeCloseTo(250);
  });
});

describe("contentBoxWidthPx", () => {
  it("subtracts horizontal padding from clientWidth", () => {
    const el = {
      clientWidth: 320,
    } as HTMLElement;
    vi.spyOn(globalThis, "getComputedStyle").mockReturnValue({
      paddingLeft: "12px",
      paddingRight: "12px",
    } as CSSStyleDeclaration);
    expect(contentBoxWidthPx(el)).toBe(296);
    vi.restoreAllMocks();
  });
});
