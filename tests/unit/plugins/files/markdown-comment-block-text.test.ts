import {
  markdownBlockPlainText,
  markdownDocumentBlockTexts,
} from "@plugins/builtin/files/renderer/markdown/comments/block-text.ts";
import { buildMarkdownCommentSurfaceFromIr } from "@plugins/builtin/files/renderer/markdown/comments/surface.ts";
import type { MarkdownIrDocument } from "@plugins/builtin/files/renderer/markdown/ir.ts";
import { markdownBlockContentHash } from "@shared/comments/markdown-hash.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import { describe, expect, it } from "vitest";
import { projectComment } from "@/lib/comments/project-thread.ts";

const RANGE = {
  endLine: 1,
  endOffset: 10,
  startLine: 1,
  startOffset: 0,
};

function doc(): MarkdownIrDocument {
  return {
    blocks: [
      {
        children: [{ kind: "text", range: RANGE, value: "Title" }],
        depth: 1,
        id: "title",
        kind: "heading",
        range: RANGE,
      },
      {
        children: [{ kind: "text", range: RANGE, value: "Body paragraph" }],
        kind: "paragraph",
        range: { ...RANGE, startLine: 3, endLine: 3 },
      },
    ],
    headings: [
      {
        depth: 1,
        id: "title",
        range: RANGE,
        text: "Title",
      },
    ],
    plainText: "Title\nBody paragraph",
    sourceLength: 20,
    version: 1,
  };
}

function mdThread(input: {
  contentHash: string;
  headingId?: string;
  path?: string;
}): CommentThread {
  return {
    comments: [
      {
        author: { kind: "user" },
        body: "note",
        createdAt: 1,
        id: "00000000-0000-4000-8000-0000000000c1",
      },
    ],
    createdAt: 1,
    id: "00000000-0000-4000-8000-0000000000t1",
    state: "open",
    target: {
      contentHash: input.contentHash,
      excerpt: "Body paragraph",
      kind: "markdown",
      path: input.path ?? "docs/a.md",
      startLine: 3,
      ...(input.headingId === undefined ? {} : { headingId: input.headingId }),
    },
    updatedAt: 2,
  };
}

describe("markdownBlockPlainText", () => {
  it("extracts heading and paragraph text", () => {
    const document = doc();
    expect(markdownBlockPlainText(document.blocks[0]!)).toBe("Title");
    expect(markdownBlockPlainText(document.blocks[1]!)).toBe("Body paragraph");
    expect(markdownDocumentBlockTexts(document.blocks)).toEqual([
      "Title",
      "Body paragraph",
    ]);
  });
});

describe("buildMarkdownCommentSurfaceFromIr + projectComment", () => {
  it("locates by content hash after move", () => {
    const surface = buildMarkdownCommentSurfaceFromIr(doc());
    const hash = markdownBlockContentHash("Body paragraph");
    const result = projectComment(mdThread({ contentHash: hash }), surface);
    expect(result.status).toBe("located");
    expect(result.locate?.kind).toBe("markdown-block");
  });

  it("does not locate by heading id when hash misses", () => {
    const surface = buildMarkdownCommentSurfaceFromIr(doc());
    const result = projectComment(
      mdThread({
        contentHash: "deadbeef",
        headingId: "title",
      }),
      surface
    );
    expect(result.status).toBe("drifted");
    expect(result.reason).toBe("content-changed");
  });

  it("drifts when content and heading miss", () => {
    const surface = buildMarkdownCommentSurfaceFromIr(doc());
    const result = projectComment(
      mdThread({ contentHash: "00000000", headingId: "gone" }),
      surface
    );
    expect(result.status).toBe("drifted");
  });
});
