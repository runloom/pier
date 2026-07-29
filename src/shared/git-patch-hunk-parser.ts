import type { HunkLineBounds } from "./git-patch-line-range.ts";

const HUNK_BOUNDS_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

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

export interface IndexedUnifiedChangeBlock extends UnifiedChangeBlock {
  readonly changeBlockIndex: number;
  readonly hunkIndex: number;
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

/** `@@ -oldStart[,oldCount] +newStart[,newCount] @@` */
export function parseUnifiedHunkHeader(header: string): HunkLineBounds | null {
  const match = HUNK_BOUNDS_RE.exec(header);
  if (match === null) {
    return null;
  }
  return {
    additionCount: Number(match[4] ?? "1"),
    additionStart: Number(match[3]),
    deletionCount: Number(match[2] ?? "1"),
    deletionStart: Number(match[1]),
  };
}

export function formatUnifiedHunkHeader(
  deletionStart: number,
  deletionCount: number,
  additionStart: number,
  additionCount: number
): string {
  // Always emit counts so pure-insert (0) / pure-delete (0) are unambiguous.
  return `@@ -${deletionStart},${deletionCount} +${additionStart},${additionCount} @@`;
}

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
  const bounds = parseUnifiedHunkHeader(hunkLines[0] ?? "");
  if (bounds === null) {
    return [];
  }
  let deletionPos = bounds.deletionStart;
  let additionPos = bounds.additionStart;
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

/**
 * Parse ordered hunk line bounds from a single-file unified patch.
 * Matches Pierre FileDiffMetadata additionStart/deletionStart (1-based).
 */
export function parseHunkBounds(
  hunks: readonly (readonly string[])[]
): readonly HunkLineBounds[] {
  const out: HunkLineBounds[] = [];
  for (const hunk of hunks) {
    const bounds = parseUnifiedHunkHeader(hunk[0] ?? "");
    if (bounds !== null) {
      out.push(bounds);
    }
  }
  return out;
}
