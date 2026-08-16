/**
 * Markdown comment navigator reveal: surface identity, close-all, page force.
 */
import { markdownPagesToForceForOffset } from "../cross-mode-anchor.ts";
import type { MarkdownIrDocument } from "../ir.ts";
import type { MarkdownSemanticPage } from "../runtime.ts";
import { blockCommentKey } from "./target.ts";
import type { MarkdownCommentNavTarget } from "./use-preview.ts";

export interface MarkdownCommentReveal {
  /** Null = close every located popover (drift / file-level reveal). */
  readonly blockKey: string | null;
  readonly document: MarkdownIrDocument | undefined;
  readonly nonce: number;
  readonly path: string | undefined;
}

export function revealMatchesSurface(
  reveal: MarkdownCommentReveal | null,
  document: MarkdownIrDocument | undefined,
  path: string | undefined
): reveal is MarkdownCommentReveal {
  return (
    reveal !== null && reveal.document === document && reveal.path === path
  );
}

export function nextMarkdownCommentReveal(
  prev: MarkdownCommentReveal | null,
  input: {
    readonly blockKey: string | null;
    readonly document: MarkdownIrDocument | undefined;
    readonly path: string | undefined;
  }
): MarkdownCommentReveal {
  return {
    blockKey: input.blockKey,
    document: input.document,
    nonce: revealMatchesSurface(prev, input.document, input.path)
      ? prev.nonce + 1
      : 1,
    path: input.path,
  };
}

export function pageIndexForCommentBlockKey(
  pages: readonly MarkdownSemanticPage[],
  blockKey: string
): number | null {
  for (const page of pages) {
    if (page.blocks.some((block) => blockCommentKey(block) === blockKey)) {
      return page.index;
    }
  }
  return null;
}

export function pagesToForceForCommentBlockKey(
  pages: readonly MarkdownSemanticPage[],
  blockKey: string
): readonly number[] {
  const pageIndex = pageIndexForCommentBlockKey(pages, blockKey);
  if (pageIndex === null) {
    return [];
  }
  const page = pages.find((entry) => entry.index === pageIndex);
  const offset = page?.blocks.find(
    (block) => blockCommentKey(block) === blockKey
  )?.range.startOffset;
  if (offset === undefined) {
    return pages
      .filter((entry) => entry.index <= pageIndex)
      .map((entry) => entry.index);
  }
  return markdownPagesToForceForOffset(pages, offset);
}

const REVEAL_SCROLL_ATTEMPTS = 12;

export function scheduleMarkdownCommentScroll(
  target: MarkdownCommentNavTarget,
  scrollRoot: HTMLElement | null
): () => void {
  let cancelled = false;
  let attempts = 0;

  const tick = (): void => {
    if (cancelled || scrollRoot === null) {
      return;
    }
    const selector =
      target.kind === "located" && target.blockKey !== undefined
        ? `[data-markdown-comment-block=${JSON.stringify(target.blockKey)}]`
        : "[data-markdown-comment-drift]";
    const el = scrollRoot.querySelector(selector);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    attempts += 1;
    if (attempts < REVEAL_SCROLL_ATTEMPTS) {
      requestAnimationFrame(tick);
    }
  };

  queueMicrotask(tick);
  return () => {
    cancelled = true;
  };
}
