import { describe, expect, it } from "vitest";
import {
  estimateLinesForFileStatus,
  fileDiffLineStats,
  type PierDiffViewItem,
  toCodeViewItem,
} from "../../../../packages/ui/src/diff-view/items.ts";
import { pierDiffItemPresentation } from "../../../../packages/ui/src/diff-view/presentation.ts";

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
  it("builds estimate as header-only (0 body lines, collapsed, no fake gutters)", () => {
    const input: PierDiffViewItem = {
      cacheKey: "estimate:section:1",
      estimateLines: estimateLinesForFileStatus("added"),
      fileDisplay: {
        path: "tests/unit/main/git/watch-root.test.ts",
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
    // 0 正文行：禁止 1..N 空行号 / unmodified lines 假文件
    expect(entry.item.fileDiff.unifiedLineCount).toBe(0);
    expect(entry.item.fileDiff.hunks).toHaveLength(0);
    expect(entry.item.fileDiff.isPartial).toBe(false);
    expect(entry.item.fileDiff.additionLines).toHaveLength(0);
    expect(entry.item.collapsed).toBe(true);
    expect(fileDiffLineStats(entry.item.fileDiff)).toEqual({
      additions: 0,
      deletions: 0,
    });
    expect(pierDiffItemPresentation(input)).toBe("loading");
  });

  it("marks self-contained new-file patches as non-partial for safe render", () => {
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
      cacheKey: "loaded:new",
      fileDisplay: { path: "b.ts", status: "added" },
      id: "section:new",
      kind: "loaded",
      patch,
    };
    const { entry, error } = toCodeViewItem(input, undefined);
    expect(error).toBeNull();
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    // processFile 默认 isPartial；Pier 无 loadDiffFiles 时必须清掉
    expect(entry.item.fileDiff.isPartial).toBe(false);
    expect(entry.item.fileDiff.additionLines.length).toBe(3);
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
