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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
 * Map a click in scroll-content pixels to a disk-side line inside the hunk.
 */
export function resolveGitBarClickLine(input: {
  readonly blocks: readonly MarkdownGitBarSourceBox[];
  readonly newLineFrom: number;
  readonly newLineTo: number;
  readonly y: number;
}): number {
  const overlapping: MarkdownGitBarSourceBox[] = [];
  for (const block of input.blocks) {
    if (
      rangesOverlap(
        input.newLineFrom,
        input.newLineTo,
        block.startLine,
        block.endLine
      )
    ) {
      overlapping.push(block);
    }
  }
  if (overlapping.length === 0) {
    return input.newLineFrom;
  }
  let hit =
    overlapping.find(
      (block) => input.y >= block.top && input.y <= block.top + block.height
    ) ?? null;
  if (!hit) {
    hit = overlapping.reduce((best, block) => {
      const mid = block.top + block.height / 2;
      const bestMid = best.top + best.height / 2;
      return Math.abs(input.y - mid) < Math.abs(input.y - bestMid)
        ? block
        : best;
    });
  }
  const span = hit.endLine - hit.startLine + 1;
  let line = hit.startLine;
  if (hit.height > 0 && span > 1) {
    const t = clamp((input.y - hit.top) / hit.height, 0, 1);
    line = Math.round(hit.startLine + t * (span - 1));
  }
  return clamp(line, input.newLineFrom, input.newLineTo);
}

/**
 * Project git change ranges onto rendered (or placeholder) source boxes.
 * Output is in scroll-content pixels so bars scroll with the article.
 */
export function mapGitRangesToPreviewBars(input: {
  readonly blocks: readonly MarkdownGitBarSourceBox[];
  readonly ranges: readonly GitGutterChangeRange[];
}): MarkdownGitBarSegment[] {
  const segments: MarkdownGitBarSegment[] = [];
  for (const range of input.ranges) {
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
