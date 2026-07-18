import { describe, expect, it } from "vitest";
import {
  fullSelectionRangeForCodeViewItem,
  selectedLinesTextFromFileDiff,
} from "../../../packages/ui/src/diff-view-selection-text.ts";

type TestFileDiff = Parameters<typeof selectedLinesTextFromFileDiff>[0];

function fileDiff(partial: {
  additionLines: string[];
  deletionLines: string[];
  isPartial: boolean;
  hunks?: TestFileDiff["hunks"];
}): TestFileDiff {
  return {
    additionLines: partial.additionLines,
    deletionLines: partial.deletionLines,
    hunks: partial.hunks ?? [],
    isPartial: partial.isPartial,
    name: "example.ts",
    type: "change",
  } as TestFileDiff;
}

describe("selectedLinesTextFromFileDiff", () => {
  it("copies contiguous addition lines from a full-file diff", () => {
    const text = selectedLinesTextFromFileDiff(
      fileDiff({
        additionLines: ["a\n", "b\n", "c\n"],
        deletionLines: ["x\n", "y\n", "z\n"],
        isPartial: false,
      }),
      { end: 3, side: "additions", start: 2 }
    );
    expect(text).toBe("b\nc");
  });

  it("copies deletion lines when selection is on the left side", () => {
    const text = selectedLinesTextFromFileDiff(
      fileDiff({
        additionLines: ["a\n", "b\n"],
        deletionLines: ["old-a\n", "old-b\n"],
        isPartial: false,
      }),
      { end: 2, side: "deletions", start: 1 }
    );
    expect(text).toBe("old-a\nold-b");
  });

  it("maps partial hunk line numbers through hunk indexes", () => {
    const text = selectedLinesTextFromFileDiff(
      fileDiff({
        additionLines: ["ctx\n", "added\n", "tail\n"],
        deletionLines: ["ctx\n", "removed\n", "tail\n"],
        hunks: [
          {
            additionCount: 3,
            additionLineIndex: 0,
            additionLines: 1,
            additionStart: 10,
            collapsedBefore: 0,
            deletionCount: 3,
            deletionLineIndex: 0,
            deletionLines: 1,
            deletionStart: 10,
            hunkContent: [],
            noEOFCRAdditions: false,
            noEOFCRDeletions: false,
            splitLineCount: 3,
            splitLineStart: 0,
            unifiedLineCount: 4,
            unifiedLineStart: 0,
          },
        ] as TestFileDiff["hunks"],
        isPartial: true,
      }),
      { end: 11, side: "additions", start: 11 }
    );
    expect(text).toBe("added");
  });
});

describe("fullSelectionRangeForCodeViewItem", () => {
  it("uses hunk bounds for partial diffs instead of line 1", () => {
    const item = {
      fileDiff: fileDiff({
        additionLines: ["ctx\n", "added\n", "tail\n"],
        deletionLines: ["ctx\n", "removed\n", "tail\n"],
        hunks: [
          {
            additionCount: 3,
            additionLineIndex: 0,
            additionLines: 1,
            additionStart: 10,
            collapsedBefore: 0,
            deletionCount: 3,
            deletionLineIndex: 0,
            deletionLines: 1,
            deletionStart: 10,
            hunkContent: [],
            noEOFCRAdditions: false,
            noEOFCRDeletions: false,
            splitLineCount: 3,
            splitLineStart: 0,
            unifiedLineCount: 4,
            unifiedLineStart: 0,
          },
        ] as TestFileDiff["hunks"],
        isPartial: true,
      }),
      id: "file-1",
      type: "diff" as const,
    };
    expect(fullSelectionRangeForCodeViewItem(item)).toEqual({
      end: 12,
      side: "additions",
      start: 10,
    });
  });

  it("falls back to deletion side when additions are empty", () => {
    const item = {
      fileDiff: fileDiff({
        additionLines: [],
        deletionLines: ["only-left\n", "gone\n"],
        isPartial: false,
      }),
      id: "file-2",
      type: "diff" as const,
    };
    expect(fullSelectionRangeForCodeViewItem(item)).toEqual({
      end: 2,
      side: "deletions",
      start: 1,
    });
  });
});
