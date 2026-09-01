import {
  annotatePierCanvasInvokeLocale,
  resolveCanvasNavLabel,
} from "@shared/contracts/pier-canvas.ts";
import { describe, expect, it } from "vitest";

const labels = {
  overview: { en: "Overview", "zh-CN": "速览" },
  path: { en: "Day 1" },
};

describe("pier-canvas locale helpers", () => {
  it("annotates slash, dollar, and goose invokes once", () => {
    expect(annotatePierCanvasInvokeLocale("/pier-canvas", "zh-CN")).toBe(
      "/pier-canvas locale=zh-CN"
    );
    expect(annotatePierCanvasInvokeLocale("$pier-canvas please", "en")).toBe(
      "$pier-canvas locale=en please"
    );
    expect(
      annotatePierCanvasInvokeLocale("/skills pier-canvas\nhello", "zh-CN")
    ).toBe("/skills pier-canvas locale=zh-CN\nhello");
    expect(
      annotatePierCanvasInvokeLocale("/skill:pier-canvas please", "zh-CN")
    ).toBe("/skill:pier-canvas locale=zh-CN please");
    expect(
      annotatePierCanvasInvokeLocale("/pier-canvas locale=ja", "zh-CN")
    ).toBe("/pier-canvas locale=ja");
    expect(annotatePierCanvasInvokeLocale("plain text", "zh-CN")).toBe(
      "plain text"
    );
  });

  it("resolves labels with locale then en fallback", () => {
    expect(resolveCanvasNavLabel(labels, "overview", "zh-CN")).toBe("速览");
    expect(resolveCanvasNavLabel(labels, "overview", "ja")).toBe("Overview");
    expect(resolveCanvasNavLabel(labels, "path", "zh-CN")).toBe("Day 1");
    expect(resolveCanvasNavLabel(labels, "missing", "en")).toBeUndefined();
  });

  it("does not stamp mode, recipe, or content from the ask", () => {
    expect(
      annotatePierCanvasInvokeLocale(
        "/pier-canvas 这里先帮我设计下对应的 UI 设计稿呢",
        "zh-CN"
      )
    ).toBe("/pier-canvas locale=zh-CN 这里先帮我设计下对应的 UI 设计稿呢");
  });
});
