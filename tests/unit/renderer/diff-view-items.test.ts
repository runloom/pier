import { describe, expect, it } from "vitest";
import {
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

describe("toCodeViewItem placeholders", () => {
  it("builds zero-hunk placeholders so unloaded files do not claim line stats", () => {
    const input: PierDiffViewItem = {
      cacheKey: "git-review-placeholder:section:1",
      fileDisplay: {
        path: "tests/unit/main/git-watch-root.test.ts",
        status: "added",
      },
      id: "section:1",
      patch: null,
    };
    const { entry, error } = toCodeViewItem(input, undefined);
    expect(error).toBeNull();
    expect(entry.item.type).toBe("diff");
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    expect(entry.item.fileDiff.hunks).toEqual([]);
    expect(fileDiffLineStats(entry.item.fileDiff)).toEqual({
      additions: 0,
      deletions: 0,
    });
    expect(pierDiffItemPresentation(input)).toBe("loading");
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
