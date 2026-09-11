import {
  captureReviewTreeSelectionKeys,
  commitReviewTreeSelectionRestore,
  restoreReviewTreeSelectionPaths,
} from "@plugins/builtin/git/renderer/review/tree/selection-rebind.ts";
import { gitReviewTreeModel } from "@plugins/builtin/git/renderer/review/tree.tsx";
import { describe, expect, it, vi } from "vitest";

const labels = {
  committed: "Changed Files",
  conflict: "Merge Changes",
  staged: "Staged Changes",
  unstaged: "Changes",
} as const;

describe("git review tree selection rebind", () => {
  it("rebinds a staged-away file onto the staged row", () => {
    const unstaged = gitReviewTreeModel(
      [
        {
          entryKey: "ek:a.ts",
          oldPaths: [],
          path: "a.ts",
          renderSlots: [
            {
              group: "unstaged",
              oldPath: null,
              sectionKey: "sec:u:a",
              status: "modified",
              targetPath: "a.ts",
            },
          ],
          status: "modified",
        },
      ],
      (name) => name,
      labels,
      { expectedIndexRevision: "1", uncommitted: true }
    );
    const file = unstaged.items.find((item) => item.kind === "file");
    expect(file).toBeTruthy();
    if (!file) {
      return;
    }
    const keys = captureReviewTreeSelectionKeys(unstaged, [file.path]);
    const staged = gitReviewTreeModel(
      [
        {
          entryKey: "ek:a.ts",
          oldPaths: [],
          path: "a.ts",
          renderSlots: [
            {
              group: "staged",
              oldPath: null,
              sectionKey: "sec:s:a",
              status: "modified",
              targetPath: "a.ts",
            },
          ],
          status: "modified",
        },
      ],
      (name) => name,
      labels,
      { expectedIndexRevision: "2", uncommitted: true }
    );
    const restored = restoreReviewTreeSelectionPaths(staged, keys);
    expect(restored).toHaveLength(1);
    expect(staged.getFileRefForTreePath(restored[0] ?? "")?.group).toBe(
      "staged"
    );
  });

  it("writes an empty restore back to the tree api", () => {
    const selectedPathsRef = { current: ["gone.ts"] as readonly string[] };
    const replaceSelectedPaths = vi.fn();
    commitReviewTreeSelectionRestore(
      selectedPathsRef,
      { replaceSelectedPaths },
      []
    );
    expect(selectedPathsRef.current).toEqual([]);
    expect(replaceSelectedPaths).toHaveBeenCalledWith([]);
  });
});
