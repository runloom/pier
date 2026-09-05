import type {
  GitGutterChangeRange,
  GitGutterKind,
} from "../../editor/git-markers.ts";
import {
  MARKDOWN_GIT_BAR_MIN_HEIGHT_PX,
  markdownGitBarPaintOrder,
} from "./layout.ts";

export interface MarkdownGitBarSourceBox {
  readonly endLine: number;
  readonly height: number;
  readonly startLine: number;
  readonly top: number;
}

export interface MarkdownGitBarSegment {
  readonly height: number;
  readonly id: string;
  readonly kind: GitGutterKind;
  readonly newLineFrom: number;
  readonly newLineTo: number;
  readonly top: number;
}

function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA <= endB && startB <= endA;
}

/**
 * Paint only the overlapping line span inside a source box, not the whole
 * outer list / blockquote.
 */
export function clipBoxToGitRange(
  block: MarkdownGitBarSourceBox,
  range: Pick<GitGutterChangeRange, "newLineFrom" | "newLineTo">
): { readonly bottom: number; readonly top: number } | null {
  if (
    !rangesOverlap(
      range.newLineFrom,
      range.newLineTo,
      block.startLine,
      block.endLine
    )
  ) {
    return null;
  }
  const overlapFrom = Math.max(block.startLine, range.newLineFrom);
  const overlapTo = Math.min(block.endLine, range.newLineTo);
  const span = block.endLine - block.startLine + 1;
  if (block.height <= 0 || span <= 0) {
    return { bottom: block.top, top: block.top };
  }
  const startT = (overlapFrom - block.startLine) / span;
  const endT = (overlapTo - block.startLine + 1) / span;
  return {
    bottom: block.top + endT * block.height,
    top: block.top + startT * block.height,
  };
}

/**
 * Project git change ranges onto rendered (or placeholder) source boxes.
 * Output is in scroll-content pixels so bars scroll with the article.
 */
export function mapGitRangesToPreviewBars(input: {
  readonly blocks: readonly MarkdownGitBarSourceBox[];
  readonly ranges: readonly GitGutterChangeRange[];
  readonly unrenderedPages?: readonly Pick<
    MarkdownGitBarSourceBox,
    "startLine" | "endLine"
  >[];
}): MarkdownGitBarSegment[] {
  const segments: MarkdownGitBarSegment[] = [];
  const sorted = [...input.blocks].sort((a, b) => a.startLine - b.startLine);
  for (const range of input.ranges) {
    if (range.kind === "deleted" && input.blocks.length > 0) {
      const next = sorted.find((block) => block.endLine >= range.newLineFrom);
      const anchor = next ?? sorted.at(-1);
      const lazy = input.unrenderedPages?.some((page) =>
        next
          ? page.endLine >= range.newLineFrom &&
            page.startLine <= next.startLine
          : page.endLine > (anchor?.endLine ?? 0)
      );
      if (lazy) continue;
      if (anchor)
        segments.push({
          id: range.id,
          kind: range.kind,
          newLineFrom: range.newLineFrom,
          newLineTo: range.newLineTo,
          height: MARKDOWN_GIT_BAR_MIN_HEIGHT_PX,
          top:
            anchor.endLine < range.newLineFrom
              ? anchor.top + anchor.height
              : anchor.top,
        });
      continue;
    }
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const block of input.blocks) {
      const clipped = clipBoxToGitRange(block, range);
      if (!clipped) {
        continue;
      }
      top = Math.min(top, clipped.top);
      bottom = Math.max(bottom, clipped.bottom);
    }
    if (!Number.isFinite(top) || bottom < top) {
      continue;
    }
    segments.push({
      height: Math.max(MARKDOWN_GIT_BAR_MIN_HEIGHT_PX, bottom - top),
      id: range.id,
      kind: range.kind,
      newLineFrom: range.newLineFrom,
      newLineTo: range.newLineTo,
      top,
    });
  }
  segments.sort(
    (left, right) =>
      markdownGitBarPaintOrder(left.kind) - markdownGitBarPaintOrder(right.kind)
  );
  return segments;
}
