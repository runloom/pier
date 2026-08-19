import { createImageDiffFileDiff } from "@pier/ui/diff-view/image-diff/file-diff.ts";
import { imageDiffStage } from "@pier/ui/diff-view/image-diff/stage.ts";
import type { PierImageDiffSide } from "@pier/ui/diff-view/image-diff/types.ts";
import { describe, expect, it } from "vitest";

function side(
  width: number,
  height: number,
  byteSize = 100
): PierImageDiffSide {
  return {
    byteSize,
    height,
    locator: {
      absolutePath: "/tmp/a.png",
      kind: "absolute",
      mime: "image/png",
      revision: "r",
    },
    width,
  };
}

describe("imageDiffStage", () => {
  it("keeps a shared scale so a smaller side does not fill the larger frame", () => {
    const stage = imageDiffStage(side(256, 256), side(512, 512));
    expect(stage).not.toBeNull();
    expect(stage?.width).toBe(384);
    expect(stage?.height).toBe(384);
    expect(stage?.before).toEqual({ height: 192, width: 192 });
    expect(stage?.after).toEqual({ height: 384, width: 384 });
    expect(stage?.pixelated).toBe(false);
  });

  it("upscales pixel icons instead of leaving them at 1×", () => {
    const stage = imageDiffStage(side(16, 16), side(16, 16));
    expect(stage?.pixelated).toBe(true);
    expect(stage?.width).toBe(192);
    expect(stage?.height).toBe(192);
  });

  it("keeps the dummy hunk free of visible placeholder copy", () => {
    const file = createImageDiffFileDiff({
      cacheKey: "icon",
      name: "icon.png",
      type: "change",
    });
    expect(JSON.stringify(file)).not.toContain("placeholder");
  });
});
