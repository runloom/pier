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
});

describe("classifyPreviewSvgMarkup", () => {
  it("decodes utf-8 bytes the same way as the text sniff", () => {
    const bytes = new TextEncoder().encode(
      "<svg xmlns='http://www.w3.org/2000/svg'></svg>"
    );
    expect(classifyPreviewSvgMarkup(bytes)).toBe("image/svg+xml");
  });
});
