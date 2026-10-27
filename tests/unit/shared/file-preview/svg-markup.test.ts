import {
  classifyPreviewSvgMarkup,
  classifyPreviewSvgMarkupText,
} from "@shared/file-preview/svg-markup.ts";
import { describe, expect, it } from "vitest";

describe("classifyPreviewSvgMarkupText", () => {
  it("accepts a bare svg root and skips preamble", () => {
    expect(
      classifyPreviewSvgMarkupText(
        "<svg xmlns='http://www.w3.org/2000/svg'></svg>"
      )
    ).toBe("image/svg+xml");
    expect(
      classifyPreviewSvgMarkupText(
        "\uFEFF<?xml version='1.0'?>\n<!-- icon -->\n<svg viewBox='0 0 8 8'></svg>"
      )
    ).toBe("image/svg+xml");
  });

  it("rejects html wrappers and random xml", () => {
    expect(
      classifyPreviewSvgMarkupText("<!doctype html><svg></svg>")
    ).toBeNull();
    expect(classifyPreviewSvgMarkupText("<root><svg></svg></root>")).toBeNull();
  });

  it("skips a doctype preamble the way SVG renderers do", () => {
    // Illustrator 等工具会输出 doctype；浏览器仍按 SVG 渲染。
    expect(
      classifyPreviewSvgMarkupText(
        "<?xml version='1.0'?><!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'><svg width='64' height='64'></svg>"
      )
    ).toBe("image/svg+xml");
  });
});

describe("classifyPreviewSvgMarkup", () => {
  it("decodes utf-8 bytes the same way as the text sniff", () => {
    const bytes = new TextEncoder().encode(
      "<svg xmlns='http://www.w3.org/2000/svg'></svg>"
    );
    expect(classifyPreviewSvgMarkup(bytes)).toBe("image/svg+xml");
  });
});
