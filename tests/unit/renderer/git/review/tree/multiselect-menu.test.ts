import {
  collectReviewTreeSelectionFileRefs,
  isReviewTreeMultiSelection,
  reviewTreeCopyPaths,
} from "@plugins/builtin/git/renderer/review/tree/selection-menu.ts";
import { gitReviewTreeModel } from "@plugins/builtin/git/renderer/review/tree.tsx";
import { buildGitReviewTreeItemMenuFlags } from "@plugins/builtin/git/renderer/review/tree-context-menu.ts";
import { describe, expect, it } from "vitest";

function entry(
  path: string,
  group: "unstaged" | "staged",
  status = "modified"
) {
  return {
    entryKey: `ek:${path}:${group}`,
    oldPaths: [] as string[],
    path,
    renderSlots: [
      {
        group,
        oldPath: null,
        sectionKey: `sec:${group}:${path}`,
        status: status as "modified" | "added",
        targetPath: path,
      },
    ],
    status: status as "modified" | "added",
  };
}

const labels = {
  committed: "Changed Files",
  conflict: "Merge Changes",
  staged: "Staged Changes",
  unstaged: "Changes",
} as const;

describe("git review tree multi-select menu", () => {
  it("unions unstaged files for stagePaths", () => {
    const model = gitReviewTreeModel(
      [
        entry("a.ts", "unstaged"),
        entry("b.ts", "unstaged"),
        entry("c.ts", "unstaged"),
      ],
      (name) => name,
      labels,
      { expectedIndexRevision: "rev-1", uncommitted: true }
    );
    const a = model.items.find(
      (item) => item.kind === "file" && item.path.endsWith("/a.ts")
    );
    const c = model.items.find(
      (item) => item.kind === "file" && item.path.endsWith("/c.ts")
    );
    expect(a && c).toBeTruthy();
    if (!(a && c)) {
      return;
    }
    expect(isReviewTreeMultiSelection(c.path, [a.path, c.path])).toBe(true);
    const refs = collectReviewTreeSelectionFileRefs(model, [a.path, c.path]);
    const flags = buildGitReviewTreeItemMenuFlags({ fileRefs: refs });
    expect(flags.stagePaths).toEqual(["a.ts", "c.ts"]);
    expect(flags.hasUnstaged).toBe(true);
    expect(flags.hasStaged).toBe(false);
  });

  it("keeps staging when a conflict is in the same selection", () => {
    const model = gitReviewTreeModel(
      [
        entry("a.ts", "unstaged"),
        {
          entryKey: "ek:c.ts:conflict",
          oldPaths: [] as string[],
          path: "c.ts",
          renderSlots: [
            {
              group: "conflict" as const,
              oldPath: null,
              sectionKey: "sec:conflict:c.ts",
              status: "conflicted" as const,
              targetPath: "c.ts",
            },
          ],
          status: "conflicted" as const,
        },
      ],
      (name) => name,
      labels,
      { expectedIndexRevision: "rev-1", uncommitted: true }
    );
    const a = model.items.find(
      (item) => item.kind === "file" && item.path.endsWith("/a.ts")
    );
    const c = model.items.find(
      (item) => item.kind === "file" && item.path.endsWith("/c.ts")
    );
    expect(a && c).toBeTruthy();
    if (!(a && c)) {
      return;
    }
    const refs = collectReviewTreeSelectionFileRefs(model, [a.path, c.path]);
    const flags = buildGitReviewTreeItemMenuFlags({ fileRefs: refs });
    expect(flags.hasConflict).toBe(true);
    expect(flags.stagePaths).toEqual(["a.ts"]);
    expect(flags.discardTrackedPaths).toEqual(["a.ts"]);
    expect(reviewTreeCopyPaths(refs)).toEqual(["a.ts", "c.ts"]);
  });

  it("keeps stage and unstage together for mixed groups", () => {
    const model = gitReviewTreeModel(
      [entry("a.ts", "unstaged"), entry("b.ts", "staged")],
      (name) => name,
      labels,
      { expectedIndexRevision: "rev-1", uncommitted: true }
    );
    const a = model.items.find(
      (item) => item.kind === "file" && item.path.endsWith("/a.ts")
    );
    const b = model.items.find(
      (item) => item.kind === "file" && item.path.endsWith("/b.ts")
    );
    expect(a && b).toBeTruthy();
    if (!(a && b)) {
      return;
    }
    const refs = collectReviewTreeSelectionFileRefs(model, [a.path, b.path]);
    const flags = buildGitReviewTreeItemMenuFlags({ fileRefs: refs });
    expect(flags.stagePaths).toEqual(["a.ts"]);
    expect(flags.unstagePaths).toEqual(["b.ts"]);
    expect(flags.hasUnstaged).toBe(true);
    expect(flags.hasStaged).toBe(true);
  });
});
