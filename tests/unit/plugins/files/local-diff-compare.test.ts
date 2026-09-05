import { describe, expect, it } from "vitest";
import { compareFileContents } from "../../../../src/plugins/builtin/files/renderer/git-changes/compare.ts";

describe("Files HEAD/current comparison", () => {
  it("keeps continuous changes separate and excerpts at real line numbers", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}\n`);
    const after = [...before];
    after[8] = "edited nine\n";
    after[12] = "edited thirteen\n";
    const result = compareFileContents({
      path: "a.ts",
      before: before.join(""),
      after: after.join(""),
      version: 7,
    });
    expect(
      result.ranges.map((r) => [r.newLineFrom, r.newLineTo, r.kind])
    ).toEqual([
      [9, 9, "modified"],
      [13, 13, "modified"],
    ]);
    expect(result.ranges[0]?.excerpt.hunks[0]?.additionStart).toBe(6);
    expect(result.ranges[0]?.excerpt.additionLines.join("")).toContain(
      "edited nine"
    );
    expect(result.ranges[0]?.excerpt.additionLines.join("")).not.toContain(
      "edited thirteen"
    );
    expect(result.ranges[0]?.excerpt.isPartial).toBe(true);
    expect(new Set(result.ranges.map((r) => r.id)).size).toBe(2);
  });
  it("anchors a whole-file deletion at line one and retains every deleted line", () => {
    const result = compareFileContents({
      path: "a.md",
      before: "one\ntwo\n",
      after: "",
      version: 1,
    });
    expect(result.ranges[0]).toMatchObject({
      kind: "deleted",
      newLineFrom: 1,
      newLineTo: 1,
      oldLineFrom: 1,
      oldLineCount: 2,
      newLineCount: 0,
    });
    expect(result.ranges[0]?.excerpt.deletionLines).toEqual(["one\n", "two\n"]);
  });
  it("handles unborn, EOF deletion, Unicode and final newline changes", () => {
    expect(
      compareFileContents({
        path: "新.md",
        before: "",
        after: "你好\n",
        version: 1,
      }).ranges[0]?.kind
    ).toBe("added");
    expect(
      compareFileContents({
        path: "a",
        before: "same\nremoved\n",
        after: "same\n",
        version: 1,
      }).ranges[0]?.newLineFrom
    ).toBe(2);
    expect(
      compareFileContents({
        path: "a",
        before: "😀",
        after: "😀\n",
        version: 1,
      }).ranges
    ).toHaveLength(1);
    expect(
      compareFileContents({
        path: "a",
        before: "same\n",
        after: "same\n",
        version: 1,
      }).ranges
    ).toEqual([]);
  });
});
