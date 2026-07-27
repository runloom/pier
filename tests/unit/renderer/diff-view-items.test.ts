import { describe, expect, it } from "vitest";
import {
  estimateLinesForFileStatus,
  fileDiffLineStats,
  type PierDiffViewItem,
  toCodeViewItem,
} from "../../../packages/ui/src/diff-view-items.ts";
import { pierDiffItemPresentation } from "../../../packages/ui/src/diff-view-presentation.ts";

describe("fileDiffLineStats", () => {
  it("sums hunk addition and deletion lines", () => {
    expect(
      fileDiffLineStats({
        hunks: [
          { additionLines: 5, deletionLines: 0 },
          { additionLines: 1, deletionLines: 2 },
        ],
      })
    ).toEqual({ additions: 6, deletions: 2 });
  });

  it("returns zero for empty placeholder hunks", () => {
    expect(fileDiffLineStats({ hunks: [] })).toEqual({
      additions: 0,
      deletions: 0,
    });
  });
});

describe("estimateLinesForFileStatus", () => {
  it("scales skeleton by status", () => {
    expect(estimateLinesForFileStatus("deleted")).toBe(4);
    expect(estimateLinesForFileStatus("added")).toBe(24);
    expect(estimateLinesForFileStatus("modified")).toBe(16);
  });
});

describe("toCodeViewItem estimate slots", () => {
  it("builds estimate geometry with status-aware body lines and zero change stats", () => {
    const input: PierDiffViewItem = {
      cacheKey: "estimate:section:1",
      estimateLines: estimateLinesForFileStatus("added"),
      fileDisplay: {
        path: "tests/unit/main/git-watch-root.test.ts",
        status: "added",
      },
      id: "section:1",
      kind: "estimate",
      patch: null,
    };
    const { entry, error } = toCodeViewItem(input, undefined);
    expect(error).toBeNull();
    expect(entry.item.type).toBe("diff");
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    // added 启发式 24 行骨架
    expect(entry.item.fileDiff.unifiedLineCount).toBe(24);
    expect(entry.item.fileDiff.hunks).toHaveLength(1);
    expect(fileDiffLineStats(entry.item.fileDiff)).toEqual({
      additions: 0,
      deletions: 0,
    });
    expect(pierDiffItemPresentation(input)).toBe("ready");
  });

  it("surfaces real addition counts after a new-file patch loads", () => {
    const patch = [
      "diff --git a/b.ts b/b.ts",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/b.ts",
      "@@ -0,0 +1,3 @@",
      "+one",
      "+two",
      "+three",
      "",
    ].join("\n");
    const input: PierDiffViewItem = {
      cacheKey: "rev:section:1",
      fileDisplay: {
        path: "b.ts",
        status: "added",
      },
      id: "section:1",
      patch,
    };
    const { entry, error } = toCodeViewItem(input, undefined);
    expect(error).toBeNull();
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    expect(fileDiffLineStats(entry.item.fileDiff)).toEqual({
      additions: 3,
      deletions: 0,
    });
  });
});
