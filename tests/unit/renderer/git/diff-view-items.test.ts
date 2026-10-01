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

  it("expands mid-file patches when both sides are present (same as conflict)", () => {
    const prefix = Array.from({ length: 30 }, (_, index) => `keep-${index}`);
    const oldContents = `${[...prefix, "change-old", "after"].join("\n")}\n`;
    const newContents = `${[...prefix, "change-new", "after"].join("\n")}\n`;
    const patch = [
      "diff --git a/mid.ts b/mid.ts",
      "index 1111111..2222222 100644",
      "--- a/mid.ts",
      "+++ b/mid.ts",
      "@@ -28,5 +28,5 @@",
      " keep-27",
      " keep-28",
      " keep-29",
      "-change-old",
      "+change-new",
      " after",
      "",
    ].join("\n");
    const input: PierDiffViewItem = {
      cacheKey: "loaded:mid-sides",
      diffFiles: { newContents, oldContents },
      fileDisplay: { path: "mid.ts", status: "modified" },
      id: "section:mid-sides",
      kind: "loaded",
      patch,
    };
    const { entry, error } = toCodeViewItem(input, undefined);
    expect(error).toBeNull();
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    expect(entry.item.fileDiff.isPartial).toBe(false);
    expect(entry.item.fileDiff.hunks[0]?.collapsedBefore ?? 0).toBeGreaterThan(
      0
    );
    expect(
      entry.item.fileDiff.additionLines.some((line) => line.includes("keep-0"))
    ).toBe(true);
    expect(
      entry.item.fileDiff.additionLines.some((line) =>
        line.includes("change-new")
      )
    ).toBe(true);
    for (const line of entry.item.fileDiff.additionLines) {
      expect(line).not.toMatch(/^(?:undefined)+$/);
    }
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

describe("toCodeViewItem conflict slots", () => {
  const stages = {
    baseOid: null,
    oursOid: null,
    theirsOid: null,
  };

  it("builds a non-collapsed conflict file with a file-level annotation", () => {
    const input: PierDiffViewItem = {
      cacheKey: "conflict:src/a.ts",
      conflict: {
        contents: "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n",
        contentsDigest: "sha256:uu",
        presentation: "markers-text",
        stages,
        xy: "UU",
      },
      fileDisplay: { path: "src/a.ts", status: "conflicted" },
      id: "section:conflict",
      kind: "conflict",
      patch: null,
    };
    const { entry, error } = toCodeViewItem(input, undefined);
    expect(error).toBeNull();
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    expect(entry.item.collapsed).toBeUndefined();
    expect(entry.item.fileDiff.cacheKey).toMatch(/^unresolved-conflict:/u);
    expect(
      entry.item.annotations?.some(
        (annotation) =>
          annotation.lineNumber === 0 &&
          annotation.metadata !== undefined &&
          "kind" in annotation.metadata &&
          annotation.metadata.kind === "unresolved-conflict"
      )
    ).toBe(true);
    expect(fileDiffLineStats(entry.item.fileDiff)).toEqual({
      additions: 0,
      deletions: 0,
    });
  });

  it("keeps conflict estimates collapsed without a dummy annotation", () => {
    const input: PierDiffViewItem = {
      cacheKey: "estimate:section:conflict",
      conflict: {
        contents: null,
        contentsDigest: "estimate:section:conflict",
        presentation: "file-level",
        stages,
        xy: "UU",
      },
      fileDisplay: { path: "src/a.ts", status: "conflicted" },
      id: "section:conflict",
      kind: "conflict",
      patch: null,
    };
    const { entry, error } = toCodeViewItem(input, undefined);
    expect(error).toBeNull();
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    expect(entry.item.collapsed).toBe(true);
    expect(entry.item.fileDiff.cacheKey ?? "").not.toMatch(
      /^unresolved-conflict:/u
    );
    expect(entry.item.annotations).toBeUndefined();
  });

  it.each([
    {
      additions: ["incoming\n"],
      deletions: [],
      oursContents: null,
      theirsContents: "incoming\n",
      type: "new",
    },
    {
      additions: [],
      deletions: ["current\n"],
      oursContents: "current\n",
      theirsContents: null,
      type: "deleted",
    },
  ] as const)("compares an absent stage as an empty $type side", ({
    additions,
    deletions,
    oursContents,
    theirsContents,
    type,
  }) => {
    const { entry, error } = toCodeViewItem(
      {
        cacheKey: `conflict:missing:${type}`,
        conflict: {
          contents: null,
          contentsDigest: `sha256:missing:${type}`,
          oursContents,
          presentation: "file-level",
          stages,
          theirsContents,
          xy: "DU",
        },
        fileDisplay: { path: "src/missing.ts", status: "conflicted" },
        id: "section:missing",
        kind: "conflict",
        patch: null,
      },
      undefined
    );
    expect(error).toBeNull();
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    expect(entry.item.id).toBe("section:missing");
    expect(entry.item.collapsed).toBeUndefined();
    expect(entry.item.annotations).toBeUndefined();
    expect(entry.item.fileDiff.type).toBe(type);
    expect(entry.item.fileDiff.additionLines).toEqual(additions);
    expect(entry.item.fileDiff.deletionLines).toEqual(deletions);
    expect(entry.item.fileDiff.isPartial).toBe(false);
    expect(entry.item.fileDiff.cacheKey).not.toMatch(/^unresolved-conflict:/u);
  });

  it("keeps complete stage buffers for expanding unmodified context", () => {
    const prefix = Array.from({ length: 30 }, (_, index) => `keep-${index}\n`);
    const oursContents = `${prefix.join("")}current\n`;
    const theirsContents = `${prefix.join("")}incoming\n`;
    const { entry, error } = toCodeViewItem(
      {
        cacheKey: "conflict:stage-context",
        conflict: {
          contents: null,
          contentsDigest: "sha256:stage-context",
          oursContents,
          presentation: "file-level",
          stages,
          theirsContents,
          xy: "DU",
        },
        fileDisplay: { path: "src/missing.ts", status: "conflicted" },
        id: "section:stage-context",
        kind: "conflict",
        patch: null,
      },
      undefined
    );
    expect(error).toBeNull();
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    expect(entry.item.fileDiff.isPartial).toBe(false);
    expect(entry.item.fileDiff.hunks[0]?.collapsedBefore).toBe(27);
    expect(entry.item.fileDiff.additionLines).toEqual([
      ...prefix,
      "incoming\n",
    ]);
    expect(entry.item.fileDiff.deletionLines).toEqual([...prefix, "current\n"]);
    expect(fileDiffLineStats(entry.item.fileDiff)).toEqual({
      additions: 1,
      deletions: 1,
    });
    expect(entry.item.annotations).toBeUndefined();
  });

  it.each([
    {
      oursContents: null,
      presentation: "file-level",
      theirsContents: null,
    },
    {
      oursContents: undefined,
      presentation: "file-level",
      theirsContents: "incoming\n",
    },
    {
      oursContents: "current\n",
      presentation: "file-level",
      theirsContents: undefined,
    },
    {
      oursContents: "current\n",
      presentation: "binary",
      theirsContents: undefined,
    },
    {
      oursContents: undefined,
      presentation: "readError",
      theirsContents: "incoming\n",
    },
  ] as const)("leaves unavailable stage material header-only ($presentation, $oursContents, $theirsContents)", ({
    oursContents,
    presentation,
    theirsContents,
  }) => {
    const { entry, error } = toCodeViewItem(
      {
        cacheKey: "conflict:unavailable",
        conflict: {
          contents: null,
          contentsDigest: "sha256:unavailable",
          ...(oursContents === undefined ? {} : { oursContents }),
          presentation,
          stages,
          ...(theirsContents === undefined ? {} : { theirsContents }),
          xy: "DU",
        },
        fileDisplay: { path: "src/missing.ts", status: "conflicted" },
        id: "section:unavailable",
        kind: "conflict",
        patch: null,
        stateNotice: "Cannot preview this file.",
      },
      undefined
    );
    expect(error).toBeNull();
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    expect(entry.item.collapsed).toBe(true);
    expect(entry.item.annotations).toBeUndefined();
    expect(entry.item.fileDiff.hunks).toEqual([]);
    expect(entry.item.fileDiff.additionLines).toEqual([]);
    expect(entry.item.fileDiff.deletionLines).toEqual([]);
    expect(entry.item.fileDiff.splitLineCount).toBe(0);
    expect(entry.item.fileDiff.unifiedLineCount).toBe(0);
  });

  it.each([
    "",
    "unchanged\n",
  ])("collapses an empty native stage comparison (%j)", (contents) => {
    const { entry, error } = toCodeViewItem(
      {
        cacheKey: "conflict:equal-stages",
        conflict: {
          contents: null,
          contentsDigest: "sha256:equal-stages",
          oursContents: contents,
          presentation: "file-level",
          stages,
          theirsContents: contents,
          xy: "DD",
        },
        fileDisplay: { path: "src/missing.ts", status: "conflicted" },
        id: "section:equal-stages",
        kind: "conflict",
        patch: null,
      },
      undefined
    );
    expect(error).toBeNull();
    if (entry.item.type !== "diff") {
      throw new Error("expected diff item");
    }
    expect(entry.item.collapsed).toBe(true);
    expect(entry.item.annotations).toBeUndefined();
    expect(entry.item.fileDiff.hunks).toEqual([]);
    expect(entry.item.fileDiff.splitLineCount).toBe(0);
    expect(entry.item.fileDiff.unifiedLineCount).toBe(0);
  });
});
