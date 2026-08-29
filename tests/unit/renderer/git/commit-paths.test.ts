import {
  includeUnstagedChecked,
  isModEnterSubmit,
  pushAfterChecked,
} from "@plugins/builtin/git/renderer/commit/defaults.ts";
import {
  isWorkingTreeEmpty,
  resolveCommitPushAfter,
  unstagedChangeCount,
  unstagedPathsFromStatus,
} from "@plugins/builtin/git/renderer/commit/paths.ts";
import type { GitFileStatus, GitStatus } from "@shared/contracts/git.ts";
import { describe, expect, it } from "vitest";

function file(
  overrides: Partial<GitFileStatus> & Pick<GitFileStatus, "index" | "worktree">
): GitFileStatus {
  return {
    origPath: null,
    path: "src/a.ts",
    ...overrides,
  };
}

function status(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: {
      ahead: 0,
      behind: 0,
      branch: "main",
      mergedIntoDefault: null,
      oid: "abc",
      upstream: null,
      upstreamGone: false,
    },
    changeSummary: {
      changedFiles: 0,
      deletions: 0,
      excludedFiles: 0,
      insertions: 0,
      kind: "lineDelta",
    },
    counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
    files: [],
    remoteSync: null,
    repoState: { kind: "clean" },
    stashCount: 0,
    ...overrides,
  };
}

describe("unstagedPathsFromStatus", () => {
  it("includes untracked files", () => {
    expect(
      unstagedPathsFromStatus([
        file({ index: "?", path: "new.ts", worktree: "?" }),
      ])
    ).toEqual(["new.ts"]);
  });

  it("includes tracked files with worktree changes", () => {
    expect(
      unstagedPathsFromStatus([
        file({ index: "M", path: "src/a.ts", worktree: "M" }),
      ])
    ).toEqual(["src/a.ts"]);
  });

  it("skips staged-only files", () => {
    expect(
      unstagedPathsFromStatus([
        file({ index: "M", path: "src/a.ts", worktree: "." }),
      ])
    ).toEqual([]);
  });

  it("skips conflict XY codes used by deriveCounts", () => {
    expect(
      unstagedPathsFromStatus([
        file({ index: "U", path: "conflict.ts", worktree: "U" }),
        file({ index: "D", path: "deleted-theirs.ts", worktree: "D" }),
        file({ index: "A", path: "added-theirs.ts", worktree: "U" }),
      ])
    ).toEqual([]);
  });

  it("includes origPath then path for a worktree rename", () => {
    expect(
      unstagedPathsFromStatus([
        file({
          index: ".",
          origPath: "src/old.ts",
          path: "src/new.ts",
          worktree: "R",
        }),
      ])
    ).toEqual(["src/old.ts", "src/new.ts"]);
  });
});

describe("commit status helpers", () => {
  it("treats modified plus untracked as unstaged change count", () => {
    expect(
      unstagedChangeCount(
        status({
          counts: { conflict: 0, modified: 2, staged: 1, untracked: 3 },
        })
      )
    ).toBe(5);
  });

  it("treats a fully clean counts snapshot as empty", () => {
    expect(isWorkingTreeEmpty(status())).toBe(true);
    expect(
      isWorkingTreeEmpty(
        status({
          counts: { conflict: 0, modified: 0, staged: 1, untracked: 0 },
        })
      )
    ).toBe(false);
  });
});

describe("resolveCommitPushAfter", () => {
  it("hides the checkbox when detached", () => {
    expect(
      resolveCommitPushAfter(
        status({
          branch: {
            ahead: 0,
            behind: 0,
            branch: null,
            mergedIntoDefault: null,
            oid: "abc",
            upstream: null,
            upstreamGone: false,
          },
        })
      )
    ).toEqual({ action: null, disabledReason: null, visible: false });
  });

  it("offers publish when there is no upstream", () => {
    expect(resolveCommitPushAfter(status()).action).toBe("publish");
  });

  it("offers push when an upstream exists", () => {
    expect(
      resolveCommitPushAfter(
        status({
          branch: {
            ahead: 0,
            behind: 0,
            branch: "main",
            mergedIntoDefault: null,
            oid: "abc",
            upstream: "origin/main",
            upstreamGone: false,
          },
        })
      )
    ).toEqual({ action: "push", disabledReason: null, visible: true });
  });

  it("disables when remote auth is required", () => {
    expect(
      resolveCommitPushAfter(
        status({
          remoteSync: { lastSuccessAt: null, state: "authRequired" },
        })
      )
    ).toEqual({ action: null, disabledReason: "auth", visible: true });
  });
});

describe("commit checkbox defaults", () => {
  it("checks include-unstaged when there are unstaged files and no intent", () => {
    expect(includeUnstagedChecked(2, null)).toBe(true);
    expect(includeUnstagedChecked(0, null)).toBe(false);
    expect(includeUnstagedChecked(0, true)).toBe(false);
  });

  it("keeps an explicit include intent while unstaged files remain", () => {
    expect(includeUnstagedChecked(1, false)).toBe(false);
    expect(includeUnstagedChecked(1, true)).toBe(true);
  });

  it("follows the push setting until the user toggles, and never when ineligible", () => {
    expect(pushAfterChecked("publish", true, null)).toBe(true);
    expect(pushAfterChecked("push", false, null)).toBe(false);
    expect(pushAfterChecked(null, true, null)).toBe(false);
    expect(pushAfterChecked("push", true, false)).toBe(false);
    expect(pushAfterChecked(null, true, true)).toBe(false);
  });

  it("treats Mod+Enter as submit on both meta and ctrl", () => {
    expect(
      isModEnterSubmit({ ctrlKey: false, key: "Enter", metaKey: true })
    ).toBe(true);
    expect(
      isModEnterSubmit({ ctrlKey: true, key: "Enter", metaKey: false })
    ).toBe(true);
    expect(
      isModEnterSubmit({ ctrlKey: false, key: "Enter", metaKey: false })
    ).toBe(false);
    expect(isModEnterSubmit({ ctrlKey: false, key: "a", metaKey: true })).toBe(
      false
    );
  });
});
