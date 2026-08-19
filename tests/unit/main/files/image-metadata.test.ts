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
