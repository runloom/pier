import { describe, expect, it } from "vitest";
import {
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

describe("toCodeViewItem estimate slots", () => {
  it("builds estimate as header-only (0 body lines, collapsed, no fake gutters)", () => {
    const input: PierDiffViewItem = {
      cacheKey: "estimate:section:1",
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

  it("keeps patch-only new-file diffs as isPartial (no loadDiffFiles)", () => {
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
    // 金标准：无全文缓冲时 isPartial 必须为 true，禁止假全文展开 collapsed
    expect(entry.item.fileDiff.isPartial).toBe(true);
    expect(entry.item.fileDiff.additionLines.length).toBe(3);
    expect(
      entry.item.fileDiff.additionLines.every(
        (line) =>
          typeof line === "string" && !line.includes("undefinedundefined")
      )
    ).toBe(true);
  });

  it("keeps mid-file patches isPartial so collapsed context cannot glue undefined", () => {
    // 对齐 plan-types 类中段变更：collapsedBefore > 0、hunk 局部缓冲
    const patch = [
      "diff --git a/plan-types.ts b/plan-types.ts",
      "index 1111111..2222222 100644",
      "--- a/plan-types.ts",
      "+++ b/plan-types.ts",
      "@@ -32,6 +32,12 @@ export type PlanTargetOperation =",
      "       skillId: string;",
      "       expectedRelativeLinkTarget: string;",
      "     }",
      "+  | {",
      '+      kind: "adopt-symlink";',
      "+      relativeTarget: string;",
      "+      skillId: string;",
      "+      expectedRelativeLinkTarget: string;",
      "+    }",
      "   | {",
      '       kind: "delete-symlink";',
      "       relativeTarget: string;",
      "",
    ].join("\n");
    const input: PierDiffViewItem = {
      cacheKey: "loaded:mid",
      fileDisplay: { path: "plan-types.ts", status: "modified" },
      id: "section:mid",
      kind: "loaded",
      patch,
    };
    const { entry, error } = toCodeViewItem(input, undefined);
    expect(error).toBeNull();
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    expect(entry.item.fileDiff.isPartial).toBe(true);
    expect(entry.item.fileDiff.hunks[0]?.collapsedBefore ?? 0).toBeGreaterThan(
      0
    );
    for (const line of entry.item.fileDiff.additionLines) {
      expect(line).toBeTypeOf("string");
      expect(line).not.toMatch(/^(?:undefined)+$/);
    }
    for (const line of entry.item.fileDiff.deletionLines) {
      expect(line).toBeTypeOf("string");
      expect(line).not.toMatch(/^(?:undefined)+$/);
    }
    expect(
      entry.item.fileDiff.additionLines.some((line) =>
        line.includes("adopt-symlink")
      )
    ).toBe(true);
  });

  it("treats zero-hunk patches as empty body without throwing", () => {
    // mode-only / 无 @@ hunk：不得因 assert 误报 error notice
    const patch = [
      "diff --git a/empty.ts b/empty.ts",
      "index 1111111..2222222 100644",
      "--- a/empty.ts",
      "+++ b/empty.ts",
      "",
    ].join("\n");
    const input: PierDiffViewItem = {
      cacheKey: "loaded:empty",
      fileDisplay: { path: "empty.ts", status: "modified" },
      id: "section:empty",
      kind: "loaded",
      patch,
    };
    const { entry, error } = toCodeViewItem(input, undefined);
    // processFile 可能对无 hunk 失败或产出 0 hunk；0 hunk 不得硬 throw 覆盖
    if (error) {
      // Pierre 解析失败可接受；关键是 assert 不得把 0 hunk 当成 buffer 缺失
      expect(error.message).not.toMatch(/do not cover hunks/);
      return;
    }
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    expect(entry.item.fileDiff.hunks).toHaveLength(0);
    expect(entry.item.fileDiff.isPartial).toBe(true);
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

describe("toCodeViewItem image slots", () => {
  it("builds a non-collapsed image file with a file-level annotation", () => {
    const input: PierDiffViewItem = {
      cacheKey: "image:icon.png",
      fileDisplay: { path: "icon.png", status: "added" },
      id: "section:image",
      imageDiff: {
        after: {
          byteSize: 68,
          height: 1,
          locator: {
            absolutePath: "/tmp/icon.png",
            kind: "absolute",
            mime: "image/png",
            revision: "abs-v1:test",
          },
          width: 1,
        },
        before: null,
      },
      kind: "image",
      patch: null,
    };
    const { entry, error } = toCodeViewItem(input, undefined);
    expect(error).toBeNull();
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    expect(entry.item.collapsed).toBeUndefined();
    expect(entry.item.fileDiff.cacheKey).toMatch(/^image-diff:/u);
    expect(entry.item.annotations?.some((item) => item.lineNumber === 0)).toBe(
      true
    );
    expect(fileDiffLineStats(entry.item.fileDiff)).toEqual({
      additions: 0,
      deletions: 0,
    });
  });
});
