import { describe, expect, it } from "vitest";
import { readPreviewImageDimensions } from "../../../../src/main/files/image-metadata.ts";

/** 1×1 PNG */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("readPreviewImageDimensions", () => {
  it("reads PNG IHDR width and height", () => {
    expect(readPreviewImageDimensions(PNG_1X1)).toEqual({
      height: 1,
      width: 1,
    });
  });

  it("reads GIF logical screen descriptor", () => {
    const gif = Buffer.alloc(10);
    gif.write("GIF89a", 0, "ascii");
    gif[6] = 3;
    gif[7] = 0;
    gif[8] = 4;
    gif[9] = 0;
    expect(readPreviewImageDimensions(gif)).toEqual({ height: 4, width: 3 });
  });

  it("returns null for truncated buffers", () => {
    expect(readPreviewImageDimensions(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});

describe("readPreviewImageDimensions for SVG", () => {
  const svg = (markup: string): Buffer => Buffer.from(markup, "utf8");
  // 期望值全部来自 Chromium 实测的 <img> naturalWidth / naturalHeight。

  it("uses the viewBox extent when width and height are absent", () => {
    // 有意偏离 Chromium：浏览器把 viewBox-only 塞进 300×150（1200×700 → 257×150），
    // diff 要的是设计尺寸本身，否则宽高比与说明文字都会失真。
    expect(
      readPreviewImageDimensions(
        svg(
          "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 700'></svg>"
        )
      )
    ).toEqual({ height: 700, width: 1200 });
    expect(
      readPreviewImageDimensions(svg("<svg viewBox='0,0,256,128'></svg>"))
    ).toEqual({ height: 128, width: 256 });
  });

  it("prefers explicit width and height over viewBox", () => {
    expect(
      readPreviewImageDimensions(
        svg("<svg width='48px' height='32' viewBox='0 0 1200 700'></svg>")
      )
    ).toEqual({ height: 32, width: 48 });
  });

  it("derives the missing axis from the viewBox ratio", () => {
    // Chromium: width=320 + viewBox 16×8 → 320×160（不是 320×8）。
    expect(
      readPreviewImageDimensions(
        svg("<svg width='320' viewBox='0 0 16 8'></svg>")
      )
    ).toEqual({ height: 160, width: 320 });
    // Chromium: height=24 + viewBox 16×8 → 48×24。
    expect(
      readPreviewImageDimensions(
        svg("<svg height='24' viewBox='0 0 16 8'></svg>")
      )
    ).toEqual({ height: 24, width: 48 });
    // 方形 viewBox 下与旧行为一致。
    expect(
      readPreviewImageDimensions(
        svg("<svg width='100' viewBox='0 0 8 8'></svg>")
      )
    ).toEqual({ height: 100, width: 100 });
  });

  it("falls back to the default 300×150 viewport for a single axis", () => {
    // Chromium: 只有 width → 高 150；只有 height → 宽 300。
    expect(readPreviewImageDimensions(svg("<svg width='320'></svg>"))).toEqual({
      height: 150,
      width: 320,
    });
    expect(readPreviewImageDimensions(svg("<svg height='80'></svg>"))).toEqual({
      height: 80,
      width: 300,
    });
  });

  it("skips BOM, XML declaration and leading comments", () => {
    const markup =
      "﻿<?xml version='1.0'?>\n<!-- board -->\n<svg viewBox='0,0,256,128'></svg>";
    expect(readPreviewImageDimensions(svg(markup))).toEqual({
      height: 128,
      width: 256,
    });
  });

  it("accepts a doctype preamble the way browsers do", () => {
    const markup =
      "<?xml version='1.0'?><!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'><svg width='64' height='64'></svg>";
    expect(readPreviewImageDimensions(svg(markup))).toEqual({
      height: 64,
      width: 64,
    });
  });

  it("只读根标签，不把子元素的 width / height 当文档尺寸", () => {
    expect(
      readPreviewImageDimensions(
        svg("<svg ><!--x--><rect width='9' height='9'/></svg>")
      )
    ).toBeNull();
  });

  it("ignores width / height text quoted inside another attribute", () => {
    // Chromium: data-meta 里的 width/height 不参与，结果 300×200。
    expect(
      readPreviewImageDimensions(
        svg(
          "<svg data-meta='width=\"10\" height=\"10\"' width='300' height='200' viewBox='0 0 99 99'></svg>"
        )
      )
    ).toEqual({ height: 200, width: 300 });
  });

  it("is case-sensitive about attribute names", () => {
    // 浏览器不认 `viewbox`；这里同样不认，只剩默认视口。
    expect(
      readPreviewImageDimensions(svg("<svg viewbox='0 0 8 8'></svg>"))
    ).toBeNull();
    // 不认 `WIDTH` / `HEIGHT`：只剩 viewBox 生效。
    expect(
      readPreviewImageDimensions(
        svg("<svg WIDTH='320' HEIGHT='160' viewBox='0 0 16 8'></svg>")
      )
    ).toEqual({ height: 8, width: 16 });
  });

  it("converts absolute length units", () => {
    // Chromium: 72pt=96px，24 无单位=24px。
    expect(
      readPreviewImageDimensions(svg("<svg width='72pt' height='24'></svg>"))
    ).toEqual({ height: 24, width: 96 });
    // in / mm / cm 均按 96dpi 换算。
    expect(
      readPreviewImageDimensions(svg("<svg width='25.4mm' height='12.7mm'>"))
    ).toEqual({ height: 48, width: 96 });
  });

  it("accepts SVG number syntax", () => {
    expect(
      readPreviewImageDimensions(svg("<svg width='1e3' height='500'></svg>"))
    ).toEqual({ height: 500, width: 1000 });
    expect(
      readPreviewImageDimensions(svg("<svg width='.5' height='.5'></svg>"))
    ).toEqual({ height: 1, width: 1 });
  });

  it("treats percentage sizes as unknown", () => {
    expect(
      readPreviewImageDimensions(svg("<svg width='100%' height='100%'></svg>"))
    ).toBeNull();
    expect(
      readPreviewImageDimensions(svg("<svg width='2em' height='1em'></svg>"))
    ).toBeNull();
  });

  it("returns null when the root tag carries no size at all", () => {
    expect(
      readPreviewImageDimensions(
        svg("<svg xmlns='http://www.w3.org/2000/svg'></svg>")
      )
    ).toBeNull();
  });
});
