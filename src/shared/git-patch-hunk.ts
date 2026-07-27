/**
 * Unified-diff hunk helpers for partial stage/unstage.
 * Independent of Pierre types so main and unit tests can share pure logic.
 */

const HUNK_HEADER_RE = /^@@ /;

export interface UnifiedFilePatchParts {
  /** Lines before the first @@ (diff --git … / --- / +++ / mode). */
  readonly headerLines: readonly string[];
  /** Each entry is one hunk: first line is @@ header, rest are body lines. */
  readonly hunks: readonly (readonly string[])[];
}

/**
 * Split a single-file unified patch into header + ordered hunks.
 * Multi-file patches: only the first file section is used (review docs are 1:1).
 */
export function splitUnifiedFilePatch(patch: string): UnifiedFilePatchParts {
  const normalized = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  // Drop a single trailing empty segment from a final newline.
  if (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }

  let bodyStart = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (HUNK_HEADER_RE.test(lines[i] ?? "")) {
      bodyStart = i;
      break;
    }
  }
  if (bodyStart === 0 && !HUNK_HEADER_RE.test(lines[0] ?? "")) {
    // No hunk headers — treat whole body as header only.
    return { headerLines: lines, hunks: [] };
  }

  // If the first line is already @@, header is empty (rare).
  const firstHunkAt =
    HUNK_HEADER_RE.test(lines[0] ?? "") && bodyStart === 0 ? 0 : bodyStart;
  const headerLines =
    firstHunkAt === 0 && HUNK_HEADER_RE.test(lines[0] ?? "")
      ? []
      : lines.slice(0, firstHunkAt);

  const hunks: string[][] = [];
  let current: string[] | null = null;
  for (let i = firstHunkAt; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (HUNK_HEADER_RE.test(line)) {
      if (current) {
        hunks.push(current);
      }
      current = [line];
      continue;
    }
    // Next file in a multi-file patch — stop.
    if (line.startsWith("diff --git ")) {
      break;
    }
    if (current) {
      current.push(line);
    }
  }
  if (current) {
    hunks.push(current);
  }
  return { headerLines, hunks };
}

/**
 * Build a valid single-file patch containing only the selected hunk indexes.
 * Indexes are 0-based into the ordered @@ blocks of the original patch.
 */
export function extractHunkPatch(
  filePatch: string,
  hunkIndexes: readonly number[]
): string {
  const unique = [...new Set(hunkIndexes)].sort((a, b) => a - b);
  if (unique.length === 0) {
    throw new Error("extractHunkPatch requires at least one hunk index");
  }
  const { headerLines, hunks } = splitUnifiedFilePatch(filePatch);
  if (hunks.length === 0) {
    throw new Error("patch has no hunks");
  }
  const selected: string[][] = [];
  for (const index of unique) {
    const hunk = hunks[index];
    if (!hunk) {
      throw new Error(`hunk index out of range: ${index}`);
    }
    selected.push([...hunk]);
  }
  const outLines = [...headerLines];
  for (const hunk of selected) {
    outLines.push(...hunk);
  }
  // git apply expects a trailing newline.
  return `${outLines.join("\n")}\n`;
}

export interface UnifiedChangeBlock {
  readonly additionCount: number;
  /** 1-based new-file line of first addition (or next insertion point). */
  readonly additionStart: number;
  readonly deletionCount: number;
  /** 1-based old-file line of first deletion (or next deletion point). */
  readonly deletionStart: number;
  /** Raw unified lines including +/-/\\ prefixes (no leading @@). */
  readonly lines: readonly string[];
}

/** Segment of a @@ body: pure context or one change island. */
export type UnifiedHunkSegment =
  | {
      readonly kind: "context";
      readonly lines: readonly string[];
    }
  | {
      readonly kind: "change";
      readonly block: UnifiedChangeBlock;
    };

/**
 * Split one @@ hunk body into ordered context / change segments.
 * Change segments align with Pierre change-block pills.
 */
export function splitHunkSegments(
  hunkLines: readonly string[]
): readonly UnifiedHunkSegment[] {
  if (hunkLines.length === 0) {
    return [];
  }
  const header = hunkLines[0] ?? "";
  const match = HUNK_BOUNDS_RE.exec(header);
  if (!match) {
    return [];
  }
  let deletionPos = Number(match[1]);
  let additionPos = Number(match[3]);
  const segments: UnifiedHunkSegment[] = [];
  let contextLines: string[] = [];
  let changeLines: string[] | null = null;
  let currentAdd = 0;
  let currentDel = 0;
  let blockAddStart = additionPos;
  let blockDelStart = deletionPos;

  const flushContext = (): void => {
    if (contextLines.length === 0) {
      return;
    }
    segments.push({ kind: "context", lines: contextLines });
    contextLines = [];
  };

  const flushChange = (): void => {
    if (changeLines === null || changeLines.length === 0) {
      changeLines = null;
      currentAdd = 0;
      currentDel = 0;
      return;
    }
    segments.push({
      kind: "change",
      block: {
        additionCount: currentAdd,
        additionStart: blockAddStart,
        deletionCount: currentDel,
        deletionStart: blockDelStart,
        lines: changeLines,
      },
    });
    changeLines = null;
    currentAdd = 0;
    currentDel = 0;
  };

  for (let i = 1; i < hunkLines.length; i += 1) {
    const line = hunkLines[i] ?? "";
    if (line.startsWith("\\")) {
      // `\ No newline…` attaches to the preceding segment (change or context).
      if (changeLines !== null) {
        changeLines.push(line);
      } else if (contextLines.length > 0) {
        contextLines.push(line);
      } else if (segments.length > 0) {
        const last = segments.at(-1);
        if (last?.kind === "change") {
          segments[segments.length - 1] = {
            kind: "change",
            block: {
              ...last.block,
              lines: [...last.block.lines, line],
            },
          };
        } else if (last?.kind === "context") {
          segments[segments.length - 1] = {
            kind: "context",
            lines: [...last.lines, line],
          };
        }
      }
      continue;
    }
    if (line.startsWith("+")) {
      flushContext();
      if (changeLines === null) {
        changeLines = [];
        blockAddStart = additionPos;
        blockDelStart = deletionPos;
      }
      changeLines.push(line);
      currentAdd += 1;
      additionPos += 1;
      continue;
    }
    if (line.startsWith("-")) {
      flushContext();
      if (changeLines === null) {
        changeLines = [];
        blockAddStart = additionPos;
        blockDelStart = deletionPos;
      }
      changeLines.push(line);
      currentDel += 1;
      deletionPos += 1;
      continue;
    }
    // Context separates change islands.
    flushChange();
    contextLines.push(line);
    additionPos += 1;
    deletionPos += 1;
  }
  flushChange();
  flushContext();
  return segments;
}

/**
 * Split one @@ hunk body into change islands (maximal +/- runs).
 * Aligns with Pierre hunkContent change blocks used for UI pills.
 */
export function splitHunkChangeBlocks(
  hunkLines: readonly string[]
): readonly UnifiedChangeBlock[] {
  return splitHunkSegments(hunkLines).flatMap((segment) =>
    segment.kind === "change" ? [segment.block] : []
  );
}

function formatUnifiedHunkHeader(
  deletionStart: number,
  deletionCount: number,
  additionStart: number,
  additionCount: number
): string {
  // Always emit counts so pure-insert (0) / pure-delete (0) are unambiguous.
  return `@@ -${deletionStart},${deletionCount} +${additionStart},${additionCount} @@`;
}

/**
 * Extract a single **change block** inside a @@ hunk (UI pill scope).
 * Includes adjacent context so `git apply` / reverse-apply can locate the edit.
 * When the @@ hunk has only one change island, keeps the full original hunk.
 */
export function extractChangeBlockPatch(
  filePatch: string,
  hunkIndex: number,
  changeBlockIndex: number
): string {
  if (changeBlockIndex < 0) {
    throw new Error(`change block index out of range: ${changeBlockIndex}`);
  }
  const { headerLines, hunks } = splitUnifiedFilePatch(filePatch);
  const hunk = hunks[hunkIndex];
  if (!hunk) {
    throw new Error(`hunk index out of range: ${hunkIndex}`);
  }
  const segments = splitHunkSegments(hunk);
  const changeSegmentIndexes: number[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i]?.kind === "change") {
      changeSegmentIndexes.push(i);
    }
  }
  if (changeSegmentIndexes.length === 0) {
    throw new Error("hunk has no change blocks");
  }
  if (changeBlockIndex >= changeSegmentIndexes.length) {
    throw new Error(`change block index out of range: ${changeBlockIndex}`);
  }
  // 单岛：保留完整 @@（含全部 context），apply 更稳
  if (changeSegmentIndexes.length === 1) {
    return extractHunkPatch(filePatch, [hunkIndex]);
  }

  const targetSegIndex = changeSegmentIndexes[changeBlockIndex];
  if (targetSegIndex === undefined) {
    throw new Error(`change block index out of range: ${changeBlockIndex}`);
  }
  const target = segments[targetSegIndex];
  if (target?.kind !== "change") {
    throw new Error(`change block index out of range: ${changeBlockIndex}`);
  }

  // 相邻 context 一并带上，避免 stage/unstage reverse apply 对不上位置
  const leading =
    targetSegIndex > 0 && segments[targetSegIndex - 1]?.kind === "context"
      ? (
          segments[targetSegIndex - 1] as Extract<
            UnifiedHunkSegment,
            { kind: "context" }
          >
        ).lines
      : [];
  const trailing =
    targetSegIndex + 1 < segments.length &&
    segments[targetSegIndex + 1]?.kind === "context"
      ? (
          segments[targetSegIndex + 1] as Extract<
            UnifiedHunkSegment,
            { kind: "context" }
          >
        ).lines
      : [];

  const block = target.block;
  const contextBefore = leading.length;
  const contextAfter = trailing.length;
  // Preserve 0 for new-file pure inserts (@@ -0,0 +1,n @@); do not clamp to 1.
  const deletionStart = Math.max(0, block.deletionStart - contextBefore);
  const additionStart = Math.max(0, block.additionStart - contextBefore);
  const deletionCount = contextBefore + block.deletionCount + contextAfter;
  const additionCount = contextBefore + block.additionCount + contextAfter;

  const hunkHeader = formatUnifiedHunkHeader(
    deletionStart,
    deletionCount,
    additionStart,
    additionCount
  );
  const bodyLines = [...leading, ...block.lines, ...trailing];
  const outLines = [...headerLines, hunkHeader, ...bodyLines];
  return `${outLines.join("\n")}\n`;
}

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

/** `@@ -oldStart[,oldCount] +newStart[,newCount] @@` */
const HUNK_BOUNDS_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse ordered hunk line bounds from a single-file unified patch.
 * Matches Pierre FileDiffMetadata additionStart/deletionStart (1-based).
 */
export function parseHunkBoundsFromPatch(
  filePatch: string
): readonly HunkLineBounds[] {
  const { hunks } = splitUnifiedFilePatch(filePatch);
  const out: HunkLineBounds[] = [];
  for (const hunk of hunks) {
    const header = hunk[0] ?? "";
    const match = HUNK_BOUNDS_RE.exec(header);
    if (!match) {
      continue;
    }
    const deletionStart = Number(match[1]);
    const deletionCount = Number(match[2] ?? "1");
    const additionStart = Number(match[3]);
    const additionCount = Number(match[4] ?? "1");
    out.push({
      additionCount,
      additionStart,
      deletionCount,
      deletionStart,
    });
  }
  return out;
}

/**
 * Map a continuous same-side line range onto overlapping hunk indexes.
 * Hunk bounds use Pierre-style 1-based additionStart/deletionStart + count.
 */
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
