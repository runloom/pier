import {
  nextMarkdownCommentReveal,
  pageIndexForCommentBlockKey,
  pagesToForceForCommentBlockKey,
  revealMatchesSurface,
} from "@plugins/builtin/files/renderer/markdown/comments/reveal.ts";
import { blockCommentKey } from "@plugins/builtin/files/renderer/markdown/comments/target.ts";
import type { MarkdownBlock } from "@plugins/builtin/files/renderer/markdown/ir.ts";
import type { MarkdownSemanticPage } from "@plugins/builtin/files/renderer/markdown/runtime.ts";
import { describe, expect, it } from "vitest";

const RANGE_A = {
  endLine: 2,
  endOffset: 20,
  startLine: 1,
  startOffset: 0,
};
const RANGE_B = {
  endLine: 40,
  endOffset: 400,
  startLine: 30,
  startOffset: 300,
};

function paragraph(range: typeof RANGE_A, value: string): MarkdownBlock {
  return {
    children: [{ kind: "text", range, value }],
    kind: "paragraph",
    range,
  };
}

function page(
  index: number,
  range: typeof RANGE_A,
  blocks: readonly MarkdownBlock[]
): MarkdownSemanticPage {
  return {
    blocks: [...blocks],
    id: `page-${index}`,
    index,
    range,
  };
}

describe("nextMarkdownCommentReveal", () => {
  const document = { blocks: [] } as never;
  const path = "docs/a.md";

  it("starts nonce at 1 and can close all located popovers", () => {
    const opened = nextMarkdownCommentReveal(null, {
      blockKey: "para-1",
      document,
      path,
    });
    expect(opened.nonce).toBe(1);
    expect(opened.blockKey).toBe("para-1");
    const closed = nextMarkdownCommentReveal(opened, {
      blockKey: null,
      document,
      path,
    });
    expect(closed.nonce).toBe(2);
    expect(closed.blockKey).toBeNull();
    expect(revealMatchesSurface(closed, document, path)).toBe(true);
  });

  it("resets nonce when the document identity changes", () => {
    const first = nextMarkdownCommentReveal(null, {
      blockKey: "para-1",
      document,
      path,
    });
    const nextDoc = { blocks: [] } as never;
    const restarted = nextMarkdownCommentReveal(first, {
      blockKey: "para-1",
      document: nextDoc,
      path,
    });
    expect(restarted.nonce).toBe(1);
    expect(revealMatchesSurface(first, nextDoc, path)).toBe(false);
  });
});

describe("pageIndexForCommentBlockKey", () => {
  const early = paragraph(RANGE_A, "early");
  const late = paragraph(RANGE_B, "late");
  const pages = [page(0, RANGE_A, [early]), page(1, RANGE_B, [late])];

  it("finds the page that owns the block key", () => {
    expect(pageIndexForCommentBlockKey(pages, blockCommentKey(late))).toBe(1);
    expect(pageIndexForCommentBlockKey(pages, blockCommentKey(early))).toBe(0);
    expect(pageIndexForCommentBlockKey(pages, "missing:0:1")).toBeNull();
  });

  it("forces every page up to the comment block", () => {
    expect(
      pagesToForceForCommentBlockKey(pages, blockCommentKey(late))
    ).toEqual([0, 1]);
  });
});
