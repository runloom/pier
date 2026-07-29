export interface LineRangeSide {
  readonly end: number;
  readonly side: "additions" | "deletions";
  readonly start: number;
}

export interface HunkLineBounds {
  readonly additionCount: number;
  readonly additionStart: number;
  readonly deletionCount: number;
  readonly deletionStart: number;
}

/** Map a continuous same-side line range onto overlapping hunk indexes. */
export function hunkIndexesForLineRange(
  hunks: readonly HunkLineBounds[],
  range: LineRangeSide
): number[] {
  const from = Math.min(range.start, range.end);
  const to = Math.max(range.start, range.end);
  const indexes: number[] = [];
  for (let i = 0; i < hunks.length; i += 1) {
    const hunk = hunks[i];
    if (!hunk) {
      continue;
    }
    const start =
      range.side === "deletions" ? hunk.deletionStart : hunk.additionStart;
    const count =
      range.side === "deletions" ? hunk.deletionCount : hunk.additionCount;
    if (count <= 0) {
      continue;
    }
    const hunkEnd = start + count - 1;
    if (from <= hunkEnd && to >= start) {
      indexes.push(i);
    }
  }
  return indexes;
}
