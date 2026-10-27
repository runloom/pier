import {
  parseSvgLengthPx,
  parseSvgSizeFromRootTag,
} from "@shared/file-preview/svg-size.ts";
import { describe, expect, it } from "vitest";

/** 只取根标签，模拟调用方（先定位 `<svg …>` 再解析）。 */
function rootTag(markup: string): string {
  const end = markup.indexOf(">");
  return end < 0 ? markup : markup.slice(0, end + 1);
}

function size(markup: string) {
  return parseSvgSizeFromRootTag(rootTag(markup));
}

describe("parseSvgLengthPx", () => {
  it("reads unitless and px values", () => {
    expect(parseSvgLengthPx("320")).toBe(320);
    expect(parseSvgLengthPx(" 48px ")).toBe(48);
    expect(parseSvgLengthPx(".5")).toBe(0.5);
    expect(parseSvgLengthPx("1e3")).toBe(1000);
  });

  it("converts absolute units at 96dpi", () => {
    expect(parseSvgLengthPx("72pt")).toBeCloseTo(96, 6);
    expect(parseSvgLengthPx("1in")).toBeCloseTo(96, 6);
    expect(parseSvgLengthPx("25.4mm")).toBeCloseTo(96, 6);
    expect(parseSvgLengthPx("10cm")).toBeCloseTo(377.95, 1);
    expect(parseSvgLengthPx("3pc")).toBeCloseTo(48, 6);
  });

  it("rejects relative units and non-positive values", () => {
    expect(parseSvgLengthPx("100%")).toBeNull();
    expect(parseSvgLengthPx("2em")).toBeNull();
    expect(parseSvgLengthPx("auto")).toBeNull();
    expect(parseSvgLengthPx("0")).toBeNull();
    expect(parseSvgLengthPx("-5")).toBeNull();
  });
});

describe("parseSvgSizeFromRootTag", () => {
  it("prefers explicit width and height", () => {
    expect(
      size("<svg width='48px' height='32' viewBox='0 0 1200 700'></svg>")
    ).toEqual({ height: 32, width: 48 });
  });

  it("derives the missing axis from the viewBox ratio", () => {
    // 与 Chromium 实测一致：320 + viewBox 16×8 → 320×160。
    expect(size("<svg width='320' viewBox='0 0 16 8'></svg>")).toEqual({
      height: 160,
      width: 320,
    });
    expect(size("<svg height='24' viewBox='0 0 16 8'></svg>")).toEqual({
      height: 24,
      width: 48,
    });
  });

  it("falls back to the 300×150 default viewport per axis", () => {
    // Chromium 不是按比例补，而是直接取默认视口对应轴。
    expect(size("<svg width='320'></svg>")).toEqual({
      height: 150,
      width: 320,
    });
    expect(size("<svg height='80'></svg>")).toEqual({
      height: 80,
      width: 300,
    });
  });

  it("returns the viewBox extent when no length attributes exist", () => {
    // 有意偏离 Chromium（它会塞进 300×150）：diff 需要设计尺寸本身。
    expect(size("<svg viewBox='0 0 1200 700'></svg>")).toEqual({
      height: 700,
      width: 1200,
    });
  });

  it("ignores width / height text inside another attribute's quotes", () => {
    expect(
      size(
        `<svg data-meta='width="10" height="10"' width='300' height='200'></svg>`
      )
    ).toEqual({ height: 200, width: 300 });
  });

  it("is case-sensitive like the SVG parser", () => {
    expect(size("<svg WIDTH='320' HEIGHT='160'></svg>")).toBeNull();
    expect(size("<svg viewbox='0 0 8 8'></svg>")).toBeNull();
  });

  it("rejects unquoted attribute values", () => {
    expect(size("<svg width=320 height=160></svg>")).toBeNull();
  });

  it("returns null when the root tag carries no size", () => {
    expect(size("<svg xmlns='http://www.w3.org/2000/svg'></svg>")).toBeNull();
  });
});
