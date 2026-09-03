import { describe, expect, it } from "vitest";
import { isPreviewableReviewImagePath } from "../../../../src/shared/git-review/previewable-image.ts";

describe("isPreviewableReviewImagePath", () => {
  it("accepts previewable image extensions regardless of case", () => {
    expect(isPreviewableReviewImagePath("icon.PNG")).toBe(true);
    expect(isPreviewableReviewImagePath("dir/photo.jpeg")).toBe(true);
    expect(isPreviewableReviewImagePath("a.jpg")).toBe(true);
    expect(isPreviewableReviewImagePath("a.gif")).toBe(true);
    expect(isPreviewableReviewImagePath("a.webp")).toBe(true);
    expect(isPreviewableReviewImagePath("vector.SVG")).toBe(true);
  });

  it("rejects ico and extensionless names", () => {
    expect(isPreviewableReviewImagePath("app.ico")).toBe(false);
    expect(isPreviewableReviewImagePath("README")).toBe(false);
    expect(isPreviewableReviewImagePath("archive.tar.gz")).toBe(false);
  });
});
