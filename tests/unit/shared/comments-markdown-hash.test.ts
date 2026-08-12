import {
  markdownBlockContentHash,
  markdownCommentExcerpt,
  normalizeMarkdownCommentText,
} from "@shared/comments/markdown-hash.ts";
import { buildMarkdownCommentSurface } from "@shared/comments/markdown-surface.ts";
import { describe, expect, it } from "vitest";

describe("normalizeMarkdownCommentText", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeMarkdownCommentText("  a\n\n  b\t ")).toBe("a b");
  });
});

describe("markdownBlockContentHash", () => {
  it("is stable for equivalent whitespace", () => {
    const a = markdownBlockContentHash("hello   world");
    const b = markdownBlockContentHash("hello world");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/u);
  });

  it("changes when content changes", () => {
    expect(markdownBlockContentHash("one")).not.toBe(
      markdownBlockContentHash("two")
    );
  });
});

describe("markdownCommentExcerpt", () => {
  it("returns ellipsis for empty", () => {
    expect(markdownCommentExcerpt("   ")).toBe("…");
  });

  it("truncates long text", () => {
    const long = "x".repeat(600);
    const excerpt = markdownCommentExcerpt(long, 20);
    expect(excerpt.length).toBeLessThanOrEqual(20);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});

describe("buildMarkdownCommentSurface", () => {
  it("indexes heading ids and block hashes", () => {
    const surface = buildMarkdownCommentSurface({
      blockTexts: ["Hello world", "Second"],
      filePresent: true,
      headingIds: ["hello", "api"],
    });
    expect(surface.kind).toBe("markdown");
    expect(surface.headingIds.has("api")).toBe(true);
    expect(
      surface.blockHashes.has(markdownBlockContentHash("Hello world"))
    ).toBe(true);
  });
});
