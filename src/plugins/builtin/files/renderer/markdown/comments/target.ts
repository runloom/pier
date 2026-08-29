/**
 * 从 IR 块构造 markdown 评论锚点（createThread target）。
 */
import {
  markdownBlockContentHash,
  markdownCommentExcerpt,
} from "@shared/comments/markdown-hash.ts";
import type { MarkdownCommentTarget } from "@shared/contracts/comments/base.ts";
import type { MarkdownBlock } from "../ir.ts";
import { markdownBlockPlainText } from "./block-text.ts";

export function buildMarkdownCommentTarget(input: {
  readonly block: MarkdownBlock;
  /** 最近上方 heading id（段落等可挂章节）。 */
  readonly nearestHeadingId?: string | undefined;
  readonly path: string;
}): MarkdownCommentTarget | null {
  const plain = markdownBlockPlainText(input.block);
  if (plain.trim().length === 0) {
    return null;
  }
  const contentHash = markdownBlockContentHash(plain);
  const excerpt = markdownCommentExcerpt(plain);
  const headingId =
    input.block.kind === "heading" ? input.block.id : input.nearestHeadingId;
  return {
    contentHash,
    excerpt,
    kind: "markdown",
    path: input.path,
    startLine: input.block.range.startLine,
    endLine: input.block.range.endLine,
    ...(headingId === undefined || headingId.length === 0 ? {} : { headingId }),
  };
}

/** 为每个 top-level 块计算「最近上方 heading id」。 */
export function nearestHeadingIdsByBlockIndex(
  blocks: readonly MarkdownBlock[]
): readonly (string | undefined)[] {
  let latest: string | undefined;
  return blocks.map((block) => {
    if (block.kind === "heading") {
      latest = block.id;
      return latest;
    }
    return latest;
  });
}

export function blockCommentKey(block: MarkdownBlock): string {
  return `${block.kind}:${block.range.startOffset}:${block.range.endOffset}`;
}

/**
 * 1-based pin numbers in document order (Codex-style). One number per
 * located block, not per-block thread count — otherwise every lone comment
 * paints as "1".
 */
export function markdownCommentMarkerIndexes(
  blocks: readonly MarkdownBlock[],
  locatedByBlockKey: ReadonlyMap<
    string,
    { readonly threads: { readonly length: number } }
  >
): ReadonlyMap<string, number> {
  const indexes = new Map<string, number>();
  let next = 0;
  for (const block of blocks) {
    const key = blockCommentKey(block);
    if (indexes.has(key)) {
      continue;
    }
    const located = locatedByBlockKey.get(key);
    if (located === undefined || located.threads.length === 0) {
      continue;
    }
    next += 1;
    indexes.set(key, next);
  }
  return indexes;
}

/** Content hash for a block, or null when the block is not commentable. */
export function contentHashForBlock(block: MarkdownBlock): string | null {
  const plain = markdownBlockPlainText(block);
  if (plain.trim().length === 0) {
    return null;
  }
  return markdownBlockContentHash(plain);
}

/**
 * 把已存 markdown 锚点解析回当前 IR 的块 key。
 * 只认 contentHash；headingId 不得回退钉到章节标题。
 */
export function resolveMarkdownCommentBlockKey(input: {
  readonly blockKeyByHash: ReadonlyMap<string, string>;
  readonly contentHash: string;
}): string | undefined {
  return input.blockKeyByHash.get(input.contentHash);
}
