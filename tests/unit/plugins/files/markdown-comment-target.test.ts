import {
  blockCommentKey,
  buildMarkdownCommentTarget,
  contentHashForBlock,
  nearestHeadingIdsByBlockIndex,
  resolveMarkdownCommentBlockKey,
} from "@plugins/builtin/files/renderer/markdown/comment-target.ts";
import type { MarkdownBlock } from "@plugins/builtin/files/renderer/markdown/ir.ts";
import { markdownBlockContentHash } from "@shared/comments/markdown-hash.ts";
import { describe, expect, it } from "vitest";

const RANGE = {
  endLine: 2,
  endOffset: 20,
  startLine: 1,
  startOffset: 0,
};

describe("buildMarkdownCommentTarget", () => {
  it("builds target with hash and excerpt", () => {
    const block: MarkdownBlock = {
      children: [{ kind: "text", range: RANGE, value: "Hello world" }],
      kind: "paragraph",
      range: RANGE,
    };
    const target = buildMarkdownCommentTarget({
      block,
      nearestHeadingId: "intro",
      path: "docs/a.md",
    });
    expect(target).not.toBeNull();
    expect(target?.kind).toBe("markdown");
    expect(target?.path).toBe("docs/a.md");
    expect(target?.contentHash).toBe(markdownBlockContentHash("Hello world"));
    expect(target?.excerpt).toContain("Hello");
    expect(target?.headingId).toBe("intro");
  });

  it("uses heading id for heading blocks", () => {
    const block: MarkdownBlock = {
      children: [{ kind: "text", range: RANGE, value: "Title" }],
      depth: 1,
      id: "title",
      kind: "heading",
      range: RANGE,
    };
    const target = buildMarkdownCommentTarget({
      block,
      nearestHeadingId: "other",
      path: "docs/a.md",
    });
    expect(target?.headingId).toBe("title");
  });
});

describe("nearestHeadingIdsByBlockIndex", () => {
  it("tracks latest heading", () => {
    const blocks: MarkdownBlock[] = [
      {
        children: [{ kind: "text", range: RANGE, value: "H" }],
        depth: 1,
        id: "h1",
        kind: "heading",
        range: RANGE,
      },
      {
        children: [{ kind: "text", range: RANGE, value: "P" }],
        kind: "paragraph",
        range: RANGE,
      },
    ];
    expect(nearestHeadingIdsByBlockIndex(blocks)).toEqual(["h1", "h1"]);
    expect(blockCommentKey(blocks[0]!)).toContain("heading:");
  });
});

describe("resolveMarkdownCommentBlockKey", () => {
  const headingRange = {
    endLine: 1,
    endOffset: 10,
    startLine: 1,
    startOffset: 0,
  };
  const paraRange = {
    endLine: 3,
    endOffset: 40,
    startLine: 2,
    startOffset: 11,
  };
  const heading: MarkdownBlock = {
    children: [{ kind: "text", range: headingRange, value: "Title" }],
    depth: 1,
    id: "title",
    kind: "heading",
    range: headingRange,
  };
  const paragraph: MarkdownBlock = {
    children: [{ kind: "text", range: paraRange, value: "Body text" }],
    kind: "paragraph",
    range: paraRange,
  };
  const blocks = [heading, paragraph];
  const paraHash = markdownBlockContentHash("Body text");
  const headingHash = markdownBlockContentHash("Title");
  const blockKeyByHash = new Map([
    [headingHash, blockCommentKey(heading)],
    [paraHash, blockCommentKey(paragraph)],
  ]);

  it("prefers contentHash over headingId so paragraph comments stay on the paragraph", () => {
    const key = resolveMarkdownCommentBlockKey({
      blockKeyByHash,
      blocks,
      contentHash: paraHash,
      headingId: "title",
    });
    expect(key).toBe(blockCommentKey(paragraph));
    expect(key).not.toBe(blockCommentKey(heading));
  });

  it("falls back to heading when hash misses", () => {
    const key = resolveMarkdownCommentBlockKey({
      blockKeyByHash,
      blocks,
      contentHash: "deadbeef",
      headingId: "title",
    });
    expect(key).toBe(blockCommentKey(heading));
  });
});

describe("contentHashForBlock", () => {
  it("returns null for empty plain text", () => {
    const empty: MarkdownBlock = {
      children: [{ kind: "text", range: RANGE, value: "   " }],
      kind: "paragraph",
      range: RANGE,
    };
    expect(contentHashForBlock(empty)).toBeNull();
  });

  it("returns hash for non-empty paragraph", () => {
    const block: MarkdownBlock = {
      children: [{ kind: "text", range: RANGE, value: "Hello" }],
      kind: "paragraph",
      range: RANGE,
    };
    expect(contentHashForBlock(block)).toBe(markdownBlockContentHash("Hello"));
  });
});
