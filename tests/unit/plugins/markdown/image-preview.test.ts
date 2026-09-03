import { markdownImagePreviewFromDocument } from "@plugins/builtin/files/renderer/markdown/image-preview.ts";
import type { FileDocumentReadResult } from "@shared/contracts/file.ts";
import { describe, expect, it } from "vitest";

const SVG_MARKUP =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'></svg>";

function textDocument(
  contents: string,
  revision = "file-v1:text"
): FileDocumentReadResult {
  return {
    canonicalPath: "docs/assets/figure.svg",
    contents,
    eol: "lf",
    format: { bom: false, encoding: "utf8" },
    kind: "text",
    mode: 0o644,
    mtimeMs: 1,
    path: "docs/assets/figure.svg",
    revision,
    root: "/repo",
    size: contents.length,
    writable: true,
  };
}

describe("markdownImagePreviewFromDocument", () => {
  it("passes through raster image documents", () => {
    expect(
      markdownImagePreviewFromDocument({
        canonicalPath: "docs/assets/pic.png",
        kind: "image",
        mime: "image/png",
        mtimeMs: 1,
        path: "docs/assets/pic.png",
        revision: "file-v1:image",
        root: "/repo",
        size: 8,
      })
    ).toEqual({ mime: "image/png", revision: "file-v1:image" });
  });

  it("treats svg markup text as an svg+xml preview", () => {
    expect(markdownImagePreviewFromDocument(textDocument(SVG_MARKUP))).toEqual({
      mime: "image/svg+xml",
      revision: "file-v1:text",
    });
  });

  it("rejects ordinary text and html-wrapped svg", () => {
    expect(
      markdownImagePreviewFromDocument(textDocument("# notes\n"))
    ).toBeNull();
    expect(
      markdownImagePreviewFromDocument(
        textDocument("<!doctype html><svg></svg>")
      )
    ).toBeNull();
  });

  it("does not reclassify binary or oversized files", () => {
    expect(
      markdownImagePreviewFromDocument({
        canonicalPath: "docs/assets/figure.svg",
        kind: "binary",
        mime: "application/octet-stream",
        mtimeMs: 1,
        path: "docs/assets/figure.svg",
        revision: "file-v1:bin",
        root: "/repo",
        size: 8,
      })
    ).toBeNull();
    expect(
      markdownImagePreviewFromDocument({
        canonicalPath: "docs/assets/figure.svg",
        kind: "too-large",
        limit: 4,
        path: "docs/assets/figure.svg",
        root: "/repo",
        size: 9,
      })
    ).toBeNull();
  });
});
