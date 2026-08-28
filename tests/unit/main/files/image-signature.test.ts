import {
  classifyPreviewImageSignature,
  classifyPreviewSvgMarkup,
} from "@main/files/image-signature.ts";
import { describe, expect, it } from "vitest";

describe("classifyPreviewImageSignature", () => {
  it("does not treat SVG markup as a raster image", () => {
    expect(
      classifyPreviewImageSignature(
        Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")
      )
    ).toBeNull();
  });
});

describe("classifyPreviewSvgMarkup", () => {
  it("accepts a bare svg root", () => {
    expect(
      classifyPreviewSvgMarkup(
        Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")
      )
    ).toBe("image/svg+xml");
  });

  it("skips BOM, xml declaration, and comments", () => {
    const bytes = Buffer.from(
      "\uFEFF<?xml version='1.0'?>\n<!-- icon -->\n<svg viewBox='0 0 8 8'></svg>"
    );
    expect(classifyPreviewSvgMarkup(bytes)).toBe("image/svg+xml");
  });

  it("rejects html and random xml", () => {
    expect(
      classifyPreviewSvgMarkup(Buffer.from("<!doctype html><svg></svg>"))
    ).toBeNull();
    expect(
      classifyPreviewSvgMarkup(Buffer.from("<root><svg></svg></root>"))
    ).toBe(null);
  });
});
