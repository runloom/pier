import { useGitReviewTreeOpen } from "@plugins/builtin/git/renderer/hooks/use-tree-open.ts";
import { gitReviewTreeModel } from "@plugins/builtin/git/renderer/review/tree.tsx";
import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const TREE_LABELS = {
  committed: "Changed Files",
  conflict: "Merge Changes",
  staged: "Staged Changes",
  unstaged: "Changes",
};

function entry(path: string, sectionKey: string): GitReviewIndexEntry {
  return {
    entryKey: `entry:${path}`,
    oldPaths: [],
    path,
    renderSlots: [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey,
        status: "modified",
        targetPath: path,
      },
    ],
    status: "modified",
  };
}

describe("useGitReviewTreeOpen", () => {
  it("does not re-open the already selected section via onRequestOpen", () => {
    const onRequestOpen = vi.fn();
    const beginNavigation = vi.fn();
    const treeModel = gitReviewTreeModel(
      [entry("src/app.tsx", "section:app")],
      (name) => name,
      TREE_LABELS
    );
    const treePath = treeModel.items.find(
      (item) => item.kind === "file" && item.path.endsWith("src/app.tsx")
    )?.path;
    expect(treePath).toBeDefined();
    const { result } = renderHook(() =>
      useGitReviewTreeOpen({
        beginNavigation,
        cancelVerification: vi.fn(),
        getSelectedEntryKey: () => "entry:src/app.tsx",
        getSelectedSectionKey: () => "section:app",
        onRequestOpen,
        setSelectedTreeTarget: vi.fn(),
        treeModel,
      })
    );

    result.current.openTreeNode(treePath ?? "");
    expect(onRequestOpen).not.toHaveBeenCalled();
    expect(beginNavigation).not.toHaveBeenCalled();
  });

  it("opens a different section through onRequestOpen", () => {
    const onRequestOpen = vi.fn();
    const treeModel = gitReviewTreeModel(
      [
        entry("src/app.tsx", "section:app"),
        entry("README.md", "section:readme"),
      ],
      (name) => name,
      TREE_LABELS
    );
    const readmePath = treeModel.items.find(
      (item) => item.kind === "file" && item.path.endsWith("README.md")
    )?.path;
    expect(readmePath).toBeDefined();
    const { result } = renderHook(() =>
      useGitReviewTreeOpen({
        beginNavigation: vi.fn(),
        cancelVerification: vi.fn(),
        getSelectedEntryKey: () => "entry:src/app.tsx",
        getSelectedSectionKey: () => "section:app",
        onRequestOpen,
        setSelectedTreeTarget: vi.fn(),
        treeModel,
      })
    );

    result.current.openTreeNode(readmePath ?? "");
    expect(onRequestOpen).toHaveBeenCalledOnce();
    expect(onRequestOpen.mock.calls[0]?.[0]).toMatchObject({
      entryKey: "entry:README.md",
      sectionKey: "section:readme",
    });
  });
});
