import { markersFromDiffPatch } from "@plugins/builtin/files/renderer/files-editor-git-markers.ts";
import type { GitDiffFilePatch } from "@shared/contracts/git.ts";
import { describe, expect, it } from "vitest";

function patch(hunks: GitDiffFilePatch["hunks"]): GitDiffFilePatch {
  return { binary: false, hunks, oldPath: "a", path: "a" };
}

function hunk(
  lines: { kind: "add" | "context" | "del"; text: string }[],
  newStart: number
): GitDiffFilePatch["hunks"][number] {
  return {
    lines,
    newLines: lines.filter((l) => l.kind !== "del").length,
    newStart,
    oldLines: lines.filter((l) => l.kind !== "add").length,
    oldStart: newStart,
  };
}

describe("markersFromDiffPatch", () => {
  it("returns empty for null patch", () => {
    expect(markersFromDiffPatch(null).size).toBe(0);
  });

  it("returns empty for binary patch", () => {
    expect(
      markersFromDiffPatch({
        binary: true,
        hunks: [],
        oldPath: null,
        path: "a",
      }).size
    ).toBe(0);
  });

  it("marks pure additions as added with count 1", () => {
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "context", text: "a" },
            { kind: "add", text: "b" },
            { kind: "add", text: "c" },
            { kind: "context", text: "d" },
          ],
          1
        ),
      ])
    );
    expect([...m.entries()]).toEqual([
      [2, { count: 1, kind: "added" }],
      [3, { count: 1, kind: "added" }],
    ]);
  });

  it("marks del+add pairing as modified", () => {
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "context", text: "a" },
            { kind: "del", text: "old1" },
            { kind: "del", text: "old2" },
            { kind: "add", text: "new1" },
            { kind: "add", text: "new2" },
            { kind: "context", text: "z" },
          ],
          1
        ),
      ])
    );
    expect([...m.entries()]).toEqual([
      [2, { count: 1, kind: "modified" }],
      [3, { count: 1, kind: "modified" }],
    ]);
  });

  it("marks del>add overflow as modified + deleted(anchor next line) with count", () => {
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "context", text: "a" },
            { kind: "del", text: "o1" },
            { kind: "del", text: "o2" },
            { kind: "del", text: "o3" },
            { kind: "add", text: "n1" },
            { kind: "context", text: "z" },
          ],
          1
        ),
      ])
    );
    expect([...m.entries()]).toEqual([
      [2, { count: 1, kind: "modified" }],
      [3, { count: 2, kind: "deleted" }],
    ]);
  });

  it("anchors pure deletion at hunk end on last new line when no trailing new line", () => {
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "context", text: "a" },
            { kind: "context", text: "b" },
            { kind: "del", text: "o1" },
            { kind: "del", text: "o2" },
          ],
          1
        ),
      ])
    );
    expect([...m.entries()]).toEqual([[2, { count: 2, kind: "deleted" }]]);
  });

  it("anchors del-only hunk with no new lines at newStart", () => {
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "del", text: "o1" },
            { kind: "del", text: "o2" },
          ],
          5
        ),
      ])
    );
    expect([...m.entries()]).toEqual([[5, { count: 2, kind: "deleted" }]]);
  });

  it("merges multiple hunks independently", () => {
    const m = markersFromDiffPatch(
      patch([
        hunk([{ kind: "add", text: "x" }], 1),
        hunk(
          [
            { kind: "del", text: "y" },
            { kind: "context", text: "z" },
          ],
          10
        ),
      ])
    );
    expect([...m.entries()]).toEqual([
      [1, { count: 1, kind: "added" }],
      [10, { count: 1, kind: "deleted" }],
    ]);
  });

  it("does not overwrite higher-priority marker at anchor with deleted", () => {
    // 同锚行已有 added：删除标记不应覆盖
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "del", text: "o1" },
            { kind: "add", text: "n1" },
          ],
          1
        ),
      ])
    );
    // del+add 配对 = modified at line 1（newStart），无 pureDel，无 deleted 标记
    expect([...m.entries()]).toEqual([[1, { count: 1, kind: "modified" }]]);
  });
});
