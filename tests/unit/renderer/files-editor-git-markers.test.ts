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

  it("marks a balanced replace block as modified on every new line", () => {
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

  it("marks every new line modified when a replace grows (no green remainder)", () => {
    // VS Code range mapping: non-empty old + non-empty new → all new lines Modified.
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "context", text: "a" },
            { kind: "del", text: "old" },
            { kind: "add", text: "n1" },
            { kind: "add", text: "n2" },
            { kind: "add", text: "n3" },
            { kind: "context", text: "z" },
          ],
          1
        ),
      ])
    );
    expect([...m.entries()]).toEqual([
      [2, { count: 1, kind: "modified" }],
      [3, { count: 1, kind: "modified" }],
      [4, { count: 1, kind: "modified" }],
    ]);
  });

  it("marks shrink replace as modified only (no red on the following living line)", () => {
    // del>add used to paint deleted on the next context/new line — looks like a bug.
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
    expect([...m.entries()]).toEqual([[2, { count: 1, kind: "modified" }]]);
  });

  it("anchors pure deletion at the following new line when the block has no adds", () => {
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "context", text: "a" },
            { kind: "del", text: "o1" },
            { kind: "del", text: "o2" },
            { kind: "context", text: "z" },
          ],
          1
        ),
      ])
    );
    expect([...m.entries()]).toEqual([[2, { count: 2, kind: "deleted" }]]);
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

  it("skips identical reshuffled lines via LCS and only marks true changes", () => {
    // del: keep / old / keep2  → add: keep / new / keep2
    // equal keep/keep2 must not light green/blue; only the replaced middle is modified.
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "context", text: "head" },
            { kind: "del", text: "keep" },
            { kind: "del", text: "old" },
            { kind: "del", text: "keep2" },
            { kind: "add", text: "keep" },
            { kind: "add", text: "new" },
            { kind: "add", text: "keep2" },
            { kind: "context", text: "tail" },
          ],
          1
        ),
      ])
    );
    expect([...m.entries()]).toEqual([[3, { count: 1, kind: "modified" }]]);
  });

  it("does not paint deleted on a living modified line after a one-for-one replace", () => {
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
    expect([...m.entries()]).toEqual([[1, { count: 1, kind: "modified" }]]);
  });

  it("collapses multi-line property rewrite to modified lines without neighbor red", () => {
    // Mirrors the real CSS theme edit that looked like green/blue/red noise.
    const m = markersFromDiffPatch(
      patch([
        hunk(
          [
            { kind: "context", text: '  ".cm-gitLine-modified": {' },
            { kind: "del", text: "    backgroundColor:" },
            {
              kind: "del",
              text: '      "color-mix(in oklch, var(--status-info-bg) 90%, transparent)",',
            },
            {
              kind: "add",
              text: '    backgroundColor: "var(--diff-modification-bg)",',
            },
            { kind: "context", text: '    marginLeft: "-0.5rem",' },
            { kind: "context", text: '    paddingLeft: "0.5rem",' },
            { kind: "context", text: "  }," },
          ],
          116
        ),
      ])
    );
    expect([...m.entries()]).toEqual([[117, { count: 1, kind: "modified" }]]);
  });
});
