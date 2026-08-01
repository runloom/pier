/**
 * Unified-diff hunk helpers for partial stage/unstage.
 * Independent of Pierre types so main and unit tests can share pure logic.
 */

import {
  formatUnifiedHunkHeader,
  type IndexedUnifiedChangeBlock,
  parseHunkBounds,
  parseUnifiedHunkHeader,
  splitHunkChangeBlocks,
  splitHunkSegments,
  type UnifiedHunkSegment,
} from "./git-patch-hunk-parser.ts";
import type { HunkLineBounds } from "./git-patch-line-range.ts";

export {
  type IndexedUnifiedChangeBlock,
  splitHunkChangeBlocks,
  splitHunkSegments,
  type UnifiedChangeBlock,
  type UnifiedHunkSegment,
} from "./git-patch-hunk-parser.ts";
export {
  type HunkLineBounds,
  hunkIndexesForLineRange,
  type LineRangeSide,
} from "./git-patch-line-range.ts";

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

/**
 * Parse every change island in patch order. The coordinates are display-only;
 * callers must use their own semantic identity for mutations.
 */
export function parseChangeBlocksFromPatch(
  filePatch: string
): readonly IndexedUnifiedChangeBlock[] {
  const { hunks } = splitUnifiedFilePatch(filePatch);
  const blocks: IndexedUnifiedChangeBlock[] = [];
  for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex += 1) {
    const hunk = hunks[hunkIndex];
    if (hunk === undefined) {
      continue;
    }
    const changes = splitHunkChangeBlocks(hunk);
    for (
      let changeBlockIndex = 0;
      changeBlockIndex < changes.length;
      changeBlockIndex += 1
    ) {
      const block = changes[changeBlockIndex];
      if (block !== undefined) {
        blocks.push({ ...block, changeBlockIndex, hunkIndex });
      }
    }
  }
  return blocks;
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

export interface UnifiedChangeBlockSelection {
  readonly changeBlockIndex: number;
  readonly hunkIndex: number;
}

/** Build one file patch containing the selected change islands in patch order. */
export function extractChangeBlocksPatch(
  filePatch: string,
  selections: readonly UnifiedChangeBlockSelection[]
): string {
  const unique = [
    ...new Map(
      selections.map((selection) => [
        `${selection.hunkIndex}:${selection.changeBlockIndex}`,
        selection,
      ])
    ).values(),
  ].sort(
    (left, right) =>
      left.hunkIndex - right.hunkIndex ||
      left.changeBlockIndex - right.changeBlockIndex
  );
  if (unique.length === 0) {
    throw new Error("extractChangeBlocksPatch requires at least one block");
  }
  if (unique.length === 1) {
    const selected = unique[0];
    if (selected === undefined) {
      throw new Error("change block selection missing");
    }
    return extractChangeBlockPatch(
      filePatch,
      selected.hunkIndex,
      selected.changeBlockIndex
    );
  }
  const { headerLines, hunks } = splitUnifiedFilePatch(filePatch);
  const selectionsByHunk = new Map<number, number[]>();
  for (const selection of unique) {
    const selected = selectionsByHunk.get(selection.hunkIndex) ?? [];
    selected.push(selection.changeBlockIndex);
    selectionsByHunk.set(selection.hunkIndex, selected);
  }
  const selectedHunks: string[][] = [];
  for (const [hunkIndex, selectedBlockIndexes] of [
    ...selectionsByHunk.entries(),
  ].sort(([left], [right]) => left - right)) {
    const hunk = hunks[hunkIndex];
    if (hunk === undefined) {
      throw new Error(`hunk index out of range: ${hunkIndex}`);
    }
    selectedHunks.push(
      ...extractChangeBlockGroupsFromHunk(hunk, selectedBlockIndexes)
    );
  }
  return `${[...headerLines, ...selectedHunks.flat()].join("\n")}\n`;
}

function extractChangeBlockGroupsFromHunk(
  hunk: readonly string[],
  selectedBlockIndexes: readonly number[]
): string[][] {
  const bounds = parseUnifiedHunkHeader(hunk[0] ?? "");
  if (bounds === null) {
    throw new Error("invalid hunk header");
  }
  const segments = splitHunkSegments(hunk);
  const changeSegmentIndexes = segments.flatMap((segment, index) =>
    segment.kind === "change" ? [index] : []
  );
  const selected = [...new Set(selectedBlockIndexes)].sort(
    (left, right) => left - right
  );
  for (const blockIndex of selected) {
    if (changeSegmentIndexes[blockIndex] === undefined) {
      throw new Error(`change block index out of range: ${blockIndex}`);
    }
  }
  if (selected.length === changeSegmentIndexes.length) {
    return [[...hunk]];
  }

  const groups: number[][] = [];
  for (const blockIndex of selected) {
    const previousGroup = groups.at(-1);
    if (
      previousGroup !== undefined &&
      blockIndex === (previousGroup.at(-1) ?? -2) + 1
    ) {
      previousGroup.push(blockIndex);
    } else {
      groups.push([blockIndex]);
    }
  }

  const deletionStart = bounds.deletionStart;
  const additionStart = bounds.additionStart;
  return groups.map((group) => {
    const firstChangeSegment = changeSegmentIndexes[group[0] ?? -1];
    const lastChangeSegment = changeSegmentIndexes[group.at(-1) ?? -1];
    if (firstChangeSegment === undefined || lastChangeSegment === undefined) {
      throw new Error("selected change block group is empty");
    }
    const firstSegment =
      firstChangeSegment > 0 &&
      segments[firstChangeSegment - 1]?.kind === "context"
        ? firstChangeSegment - 1
        : firstChangeSegment;
    const lastSegment =
      lastChangeSegment + 1 < segments.length &&
      segments[lastChangeSegment + 1]?.kind === "context"
        ? lastChangeSegment + 1
        : lastChangeSegment;
    const preceding = segments.slice(0, firstSegment).flatMap(segmentLines);
    const body = segments
      .slice(firstSegment, lastSegment + 1)
      .flatMap(segmentLines);
    const consumed = countUnifiedSides(preceding);
    const counts = countUnifiedSides(body);
    return [
      formatUnifiedHunkHeader(
        deletionStart + consumed.deletions,
        counts.deletions,
        additionStart + consumed.additions,
        counts.additions
      ),
      ...body,
    ];
  });
}

function segmentLines(segment: UnifiedHunkSegment): readonly string[] {
  return segment.kind === "context" ? segment.lines : segment.block.lines;
}

function countUnifiedSides(lines: readonly string[]): {
  readonly additions: number;
  readonly deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith("\\")) {
      continue;
    }
    if (!line.startsWith("-")) {
      additions += 1;
    }
    if (!line.startsWith("+")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

/**
 * Parse ordered hunk line bounds from a single-file unified patch.
 * Matches Pierre FileDiffMetadata additionStart/deletionStart (1-based).
 */
export function parseHunkBoundsFromPatch(
  filePatch: string
): readonly HunkLineBounds[] {
  const { hunks } = splitUnifiedFilePatch(filePatch);
  return parseHunkBounds(hunks);
}
