import type { FilesDocument } from "@plugins/builtin/files/renderer/document/types.ts";
import { shouldRenderPreviewBranch } from "@plugins/builtin/files/renderer/panel/preview/index.tsx";
import { describe, expect, it } from "vitest";

const imagePreview = {
  kind: "image",
  mime: "image/png",
  revision: "r1",
} as NonNullable<FilesDocument["preview"]>;

describe("shouldRenderPreviewBranch", () => {
  it("keeps a loaded preview", () => {
    expect(
      shouldRenderPreviewBranch({
        loadState: "loaded",
        preview: imagePreview,
      })
    ).toBe(true);
  });

  it("lets a read failure win over the preserved preview", () => {
    expect(
      shouldRenderPreviewBranch({
        loadState: "error",
        preview: imagePreview,
      })
    ).toBe(false);
  });

  it("does not render without a preview", () => {
    expect(
      shouldRenderPreviewBranch({
        loadState: "loaded",
        preview: null,
      })
    ).toBe(false);
  });
});
