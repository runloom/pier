import { describe, expect, it } from "vitest";
import { primaryHunkActionForVariant } from "../../../packages/ui/src/diff-view-hunk-actions.tsx";
import {
  buildHunkActionAnnotations,
  hunkAnnotationAnchor,
  hunkChangeBlockAnchors,
} from "../../../packages/ui/src/diff-view-items.ts";

/**
 * Build a Hunk-shaped object for Codex `wa` tests.
 * noEOF defaults false (matches typical patches).
 */
function makeHunk(options: {
  additionStart: number;
  deletionStart: number;
  leadingContext?: number;
  additions?: number;
  deletions?: number;
  trailingContext?: number;
  noEOFCRAdditions?: boolean;
  noEOFCRDeletions?: boolean;
}) {
  const leading = options.leadingContext ?? 0;
  const additions = options.additions ?? 0;
  const deletions = options.deletions ?? 0;
  const trailing = options.trailingContext ?? 0;
  const hunkContent: Array<
    | {
        additionLineIndex: number;
        deletionLineIndex: number;
        lines: number;
        type: "context";
      }
    | {
        additionLineIndex: number;
        additions: number;
        deletionLineIndex: number;
        deletions: number;
        type: "change";
      }
  > = [];
  let addIdx = 0;
  let delIdx = 0;
  if (leading > 0) {
    hunkContent.push({
      additionLineIndex: addIdx,
      deletionLineIndex: delIdx,
      lines: leading,
      type: "context",
    });
    addIdx += leading;
    delIdx += leading;
  }
  if (additions > 0 || deletions > 0) {
    hunkContent.push({
      additionLineIndex: addIdx,
      additions,
      deletionLineIndex: delIdx,
      deletions,
      type: "change",
    });
    addIdx += additions;
    delIdx += deletions;
  }
  if (trailing > 0) {
    hunkContent.push({
      additionLineIndex: addIdx,
      deletionLineIndex: delIdx,
      lines: trailing,
      type: "context",
    });
  }
  return {
    additionCount: leading + additions + trailing,
    additionLineIndex: 0,
    additionLines: additions,
    additionStart: options.additionStart,
    collapsedBefore: 0,
    deletionCount: leading + deletions + trailing,
    deletionLineIndex: 0,
    deletionLines: deletions,
    deletionStart: options.deletionStart,
    hunkContent,
    noEOFCRAdditions: options.noEOFCRAdditions === true,
    noEOFCRDeletions: options.noEOFCRDeletions === true,
    splitLineCount: leading + Math.max(additions, deletions) + trailing,
    splitLineStart: 0,
    unifiedLineCount: leading + additions + deletions + trailing,
    unifiedLineStart: 0,
  };
}

describe("primaryHunkActionForVariant (Codex)", () => {
  it("maps unstaged → stage and staged → unstage", () => {
    expect(primaryHunkActionForVariant("unstaged")).toBe("stage");
    expect(primaryHunkActionForVariant("staged")).toBe("unstage");
  });
});

describe("hunkAnnotationAnchor (Codex wa)", () => {
  it("skips leading context and anchors last addition of the change", () => {
    // Codex: context advances cursors only; change +1 at add line 2
    const hunk = makeHunk({
      additionStart: 1,
      deletionStart: 1,
      leadingContext: 1,
      additions: 1,
      deletions: 1,
    });
    expect(hunkAnnotationAnchor(hunk)).toEqual({
      lineNumber: 2,
      side: "additions",
    });
  });

  it("does not use trailing context as the anchor", () => {
    // change +1 at line 5, then 2 context lines → still anchors change end (5)
    const hunk = makeHunk({
      additionStart: 5,
      deletionStart: 5,
      leadingContext: 0,
      additions: 1,
      deletions: 1,
      trailingContext: 2,
    });
    expect(hunkAnnotationAnchor(hunk)).toEqual({
      lineNumber: 5,
      side: "additions",
    });
  });

  it("prefers additions over deletions in the same change block", () => {
    const hunk = makeHunk({
      additionStart: 10,
      deletionStart: 10,
      additions: 2,
      deletions: 3,
    });
    // last addition line = 10+2-1 = 11 (not last deletion 12)
    expect(hunkAnnotationAnchor(hunk)).toEqual({
      lineNumber: 11,
      side: "additions",
    });
  });

  it("uses deletions when the change has no additions", () => {
    const hunk = makeHunk({
      additionStart: 0,
      deletionStart: 20,
      additions: 0,
      deletions: 3,
    });
    expect(hunkAnnotationAnchor(hunk)).toEqual({
      lineNumber: 22,
      side: "deletions",
    });
  });

  it("last change block wins when multiple changes exist", () => {
    const hunk = {
      additionCount: 4,
      additionLineIndex: 0,
      additionLines: 2,
      additionStart: 1,
      collapsedBefore: 0,
      deletionCount: 2,
      deletionLineIndex: 0,
      deletionLines: 2,
      deletionStart: 1,
      hunkContent: [
        {
          additionLineIndex: 0,
          additions: 1,
          deletionLineIndex: 0,
          deletions: 1,
          type: "change" as const,
        },
        {
          additionLineIndex: 1,
          deletionLineIndex: 1,
          lines: 1,
          type: "context" as const,
        },
        {
          additionLineIndex: 2,
          additions: 1,
          deletionLineIndex: 2,
          deletions: 1,
          type: "change" as const,
        },
      ],
      noEOFCRAdditions: false,
      noEOFCRDeletions: false,
      splitLineCount: 4,
      splitLineStart: 0,
      unifiedLineCount: 4,
      unifiedLineStart: 0,
    };
    // second change: after first (+1/-1) and 1 context → add cursor 3, +1 → line 3
    expect(hunkAnnotationAnchor(hunk)).toEqual({
      lineNumber: 3,
      side: "additions",
    });
    // UI: one pill per change island (same hunkIndex when built)
    expect(hunkChangeBlockAnchors(hunk)).toEqual([
      { lineNumber: 1, side: "additions" },
      { lineNumber: 3, side: "additions" },
    ]);
  });

  it("emits one annotation per change block (not only last per hunk)", () => {
    const multiChangeHunk = {
      additionCount: 4,
      additionLineIndex: 0,
      additionLines: 2,
      additionStart: 1,
      collapsedBefore: 0,
      deletionCount: 2,
      deletionLineIndex: 0,
      deletionLines: 2,
      deletionStart: 1,
      hunkContent: [
        {
          additionLineIndex: 0,
          additions: 1,
          deletionLineIndex: 0,
          deletions: 1,
          type: "change" as const,
        },
        {
          additionLineIndex: 1,
          deletionLineIndex: 1,
          lines: 1,
          type: "context" as const,
        },
        {
          additionLineIndex: 2,
          additions: 1,
          deletionLineIndex: 2,
          deletions: 1,
          type: "change" as const,
        },
      ],
      noEOFCRAdditions: false,
      noEOFCRDeletions: false,
      splitLineCount: 4,
      splitLineStart: 0,
      unifiedLineCount: 4,
      unifiedLineStart: 0,
    };
    const fileDiff = {
      additionLines: ["a", "b"],
      cacheKey: "t",
      deletionLines: ["a", "b"],
      hunks: [
        multiChangeHunk,
        makeHunk({
          additionStart: 20,
          deletionStart: 20,
          additions: 0,
          deletions: 2,
        }),
      ],
      isPartial: false,
      name: "src/a.ts",
      splitLineCount: 8,
      type: "change" as const,
      unifiedLineCount: 10,
    };
    const annotations = buildHunkActionAnnotations(fileDiff, {
      state: "unstaged",
    });
    // 2 change blocks in first hunk + 1 in second
    expect(annotations).toHaveLength(3);
    expect(annotations?.map((a) => a.metadata.hunkIndex)).toEqual([0, 0, 1]);
    expect(annotations?.map((a) => a.metadata.changeBlockIndex)).toEqual([
      0, 1, 0,
    ]);
    expect(annotations?.map((a) => a.lineNumber)).toEqual([1, 3, 21]);
  });

  it("falls back to additionLines when hunkContent is empty", () => {
    const hunk = {
      additionCount: 3,
      additionLineIndex: 0,
      additionLines: 2,
      additionStart: 10,
      collapsedBefore: 0,
      deletionCount: 1,
      deletionLineIndex: 0,
      deletionLines: 0,
      deletionStart: 10,
      hunkContent: [] as [],
      noEOFCRAdditions: false,
      noEOFCRDeletions: false,
      splitLineCount: 3,
      splitLineStart: 0,
      unifiedLineCount: 3,
      unifiedLineStart: 0,
    };
    expect(hunkAnnotationAnchor(hunk)).toEqual({
      lineNumber: 11,
      side: "additions",
    });
  });
});
