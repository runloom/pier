/**
 * Parse git unified-diff hunk headers into old/new line ranges.
 * Shared by host projection and git plugin drift classification.
 */

/** Closed interval [start, end] (1-based file lines). */
export type HunkLineRange = readonly [number, number];

export interface HunkLineRanges {
  readonly new: readonly HunkLineRange[];
  readonly old: readonly HunkLineRange[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;

/**
 * 解析 patch 的 hunk headers 得到 old/new 行范围集合
 * （`@@ -oldStart,oldLen +newStart,newLen @@`，len 缺省为 1）。
 */
export function parseHunkLineRanges(patch: string): HunkLineRanges {
  const oldRanges: HunkLineRange[] = [];
  const newRanges: HunkLineRange[] = [];
  for (const match of patch.matchAll(HUNK_HEADER)) {
    const oldStart = Number(match[1]);
    const oldLen = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newLen = match[4] === undefined ? 1 : Number(match[4]);
    oldRanges.push([oldStart, oldStart + oldLen - 1]);
    newRanges.push([newStart, newStart + newLen - 1]);
  }
  return { new: newRanges, old: oldRanges };
}

export function lineInHunkRanges(
  line: number,
  side: "additions" | "deletions",
  ranges: HunkLineRanges
): boolean {
  const rangesForSide = side === "deletions" ? ranges.old : ranges.new;
  return rangesForSide.some(([start, end]) => line >= start && line <= end);
}
