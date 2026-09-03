import {
  classifyPreviewImageBytes,
  classifyPreviewImageSignature,
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

describe("classifyPreviewImageBytes", () => {
  it("accepts raster signatures and svg markup", () => {
    expect(
      classifyPreviewImageBytes(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      )
    ).toBe("image/png");
    expect(
      classifyPreviewImageBytes(
        Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")
      )
    ).toBe("image/svg+xml");
  });

  it("rejects html-wrapped svg and random bytes", () => {
    expect(
      classifyPreviewImageBytes(Buffer.from("<!doctype html><svg></svg>"))
    ).toBeNull();
    expect(classifyPreviewImageBytes(Buffer.from([0, 1, 2, 3]))).toBeNull();
  });
});
