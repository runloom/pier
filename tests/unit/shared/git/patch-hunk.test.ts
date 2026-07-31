import { describe, expect, it } from "vitest";
import {
  extractChangeBlockPatch,
  extractChangeBlocksPatch,
  extractHunkPatch,
  hunkIndexesForLineRange,
  parseHunkBoundsFromPatch,
  splitHunkChangeBlocks,
  splitUnifiedFilePatch,
} from "../../../../src/shared/git-patch-hunk.ts";

const SAMPLE_PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line1
-old
+new
 line3
@@ -10,2 +11,3 @@
 keep
+debug
`;

describe("splitUnifiedFilePatch", () => {
  it("separates header and ordered hunks", () => {
    const parts = splitUnifiedFilePatch(SAMPLE_PATCH);
    expect(parts.headerLines[0]).toBe("diff --git a/src/a.ts b/src/a.ts");
    expect(parts.hunks).toHaveLength(2);
    expect(parts.hunks[0]?.[0]).toMatch(/^@@ -1,3 \+1,4 @@/);
    expect(parts.hunks[1]?.[0]).toMatch(/^@@ -10,2 \+11,3 @@/);
  });
});

describe("extractHunkPatch", () => {
  it("keeps file header and selected hunks only", () => {
    const partial = extractHunkPatch(SAMPLE_PATCH, [1]);
    expect(partial).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(partial).toContain("@@ -10,2 +11,3 @@");
    expect(partial).toContain("+debug");
    expect(partial).not.toContain("+new");
    expect(partial.endsWith("\n")).toBe(true);
  });

  it("can extract multiple hunks in order", () => {
    const partial = extractHunkPatch(SAMPLE_PATCH, [1, 0]);
    const first = partial.indexOf("@@ -1,3");
    const second = partial.indexOf("@@ -10,2");
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  });

  it("rejects empty and out-of-range indexes", () => {
    expect(() => extractHunkPatch(SAMPLE_PATCH, [])).toThrow(/at least one/);
    expect(() => extractHunkPatch(SAMPLE_PATCH, [9])).toThrow(/out of range/);
  });
});

describe("parseHunkBoundsFromPatch", () => {
  it("parses @@ starts and counts", () => {
    const bounds = parseHunkBoundsFromPatch(SAMPLE_PATCH);
    expect(bounds).toEqual([
      {
        additionCount: 4,
        additionStart: 1,
        deletionCount: 3,
        deletionStart: 1,
      },
      {
        additionCount: 3,
        additionStart: 11,
        deletionCount: 2,
        deletionStart: 10,
      },
    ]);
  });
});

describe("hunkIndexesForLineRange", () => {
  const hunks = [
    {
      additionCount: 4,
      additionStart: 1,
      deletionCount: 3,
      deletionStart: 1,
    },
    {
      additionCount: 3,
      additionStart: 11,
      deletionCount: 2,
      deletionStart: 10,
    },
  ];

  it("maps addition lines to the overlapping hunk", () => {
    expect(
      hunkIndexesForLineRange(hunks, {
        end: 12,
        side: "additions",
        start: 11,
      })
    ).toEqual([1]);
  });

  it("maps deletion lines to the overlapping hunk", () => {
    expect(
      hunkIndexesForLineRange(hunks, {
        end: 2,
        side: "deletions",
        start: 1,
      })
    ).toEqual([0]);
  });
});

const MULTI_BLOCK_PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,8 +1,10 @@
 keep-a
-old-one
+new-one
 mid-context
-old-two
+new-two
 keep-b
`;

describe("splitHunkChangeBlocks / extractChangeBlockPatch", () => {
  it("splits one @@ into two change islands", () => {
    const { hunks } = splitUnifiedFilePatch(MULTI_BLOCK_PATCH);
    const blocks = splitHunkChangeBlocks(hunks[0] ?? []);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.lines.join("\n")).toContain("+new-one");
    expect(blocks[0]?.lines.join("\n")).not.toContain("+new-two");
    expect(blocks[1]?.lines.join("\n")).toContain("+new-two");
    expect(blocks[1]?.lines.join("\n")).not.toContain("+new-one");
  });

  it("staging lower block does not include upper change lines but keeps adjacent context", () => {
    const lower = extractChangeBlockPatch(MULTI_BLOCK_PATCH, 0, 1);
    expect(lower).toContain("+new-two");
    expect(lower).toContain("-old-two");
    expect(lower).not.toContain("+new-one");
    expect(lower).not.toContain("-old-one");
    // mid-context before + keep-b after for reliable git apply / reverse
    expect(lower).toContain(" mid-context");
    expect(lower).toContain(" keep-b");
    expect(lower).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(lower).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it("staging upper block does not include lower change lines but keeps adjacent context", () => {
    const upper = extractChangeBlockPatch(MULTI_BLOCK_PATCH, 0, 0);
    expect(upper).toContain("+new-one");
    expect(upper).not.toContain("+new-two");
    expect(upper).toContain(" keep-a");
    expect(upper).toContain(" mid-context");
  });

  it("single-island hunk keeps full @@ with context", () => {
    const only = extractChangeBlockPatch(SAMPLE_PATCH, 0, 0);
    expect(only).toContain(" line1");
    expect(only).toContain("+new");
    expect(only).toContain(" line3");
  });

  it("多个相邻变更岛合并时保留原始完整 hunk，且不复制共享上下文", () => {
    const combined = extractChangeBlocksPatch(MULTI_BLOCK_PATCH, [
      { changeBlockIndex: 0, hunkIndex: 0 },
      { changeBlockIndex: 1, hunkIndex: 0 },
    ]);
    expect(combined).toBe(MULTI_BLOCK_PATCH);
    expect(combined.match(/ mid-context/g)).toHaveLength(1);
    expect(splitUnifiedFilePatch(combined).hunks).toHaveLength(1);
  });

  it("preserves 0 starts when recomputing multi-island pure-add headers", () => {
    // Hand-crafted: two pure-add islands after /dev/null (deletion starts at 0).
    // Context line between islands forces multi-island extract path.
    const multi = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,4 @@
+a
 mid
+b
`;
    const blocks = splitHunkChangeBlocks(
      splitUnifiedFilePatch(multi).hunks[0] ?? []
    );
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks[0]?.deletionStart).toBe(0);
    const first = extractChangeBlockPatch(multi, 0, 0);
    expect(first).toMatch(/@@ -0,/);
    expect(first).not.toMatch(/@@ -1,0 /);
    expect(first).toContain("+a");
    expect(first).not.toContain("+b");
  });
});
