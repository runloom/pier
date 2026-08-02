import {
  GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM,
  gitChangesPanelTabChrome,
  gitChangesPanelTabIconId,
  gitChangesPanelTitle,
  gitLineDeltaTrailingFromSummary,
  gitReviewTabChangeSummary,
  gitRootFolderName,
  shortGitReviewRef,
} from "@plugins/builtin/git/renderer/changes-tab-title.ts";
import { describe, expect, it } from "vitest";

const LABELS = {
  branchLabel: "Branch",
  pathLabel: "Path",
  targetBranchLabel: "Branch",
  targetCommitLabel: "Commit",
  targetLabel: "Target",
  targetUncommittedLabel: "Uncommitted",
  typeLabel: "Changes",
} as const;

describe("gitChangesPanelTitle", () => {
  it("uses git root folder name for uncommitted scope", () => {
    expect(
      gitChangesPanelTitle({
        gitRootPath: "/Users/dev/ABC/pier.worktree/status-bar-ui-polish",
        target: { kind: "uncommitted" },
      })
    ).toBe("status-bar-ui-polish");
  });

  it("appends short oid for commit scope", () => {
    expect(
      gitChangesPanelTitle({
        gitRootPath: "/repo",
        target: {
          kind: "commit",
          oid: "abcdef0123456789abcdef0123456789abcdef01",
        },
      })
    ).toBe("repo · abcdef0");
  });

  it("appends short ref for branch scope", () => {
    expect(
      gitChangesPanelTitle({
        gitRootPath: "/workspace/feature-auth",
        target: { kind: "branch", ref: "refs/heads/main" },
      })
    ).toBe("feature-auth · main");
  });

  it("handles windows-style separators", () => {
    expect(gitRootFolderName("C:\\Users\\dev\\pier")).toBe("pier");
  });

  it("strips refs/remotes prefix", () => {
    expect(shortGitReviewRef("refs/remotes/origin/main")).toBe("origin/main");
  });
});

describe("gitChangesPanelTabIconId", () => {
  it("maps review target kinds to distinct tab icon ids", () => {
    expect(gitChangesPanelTabIconId({ kind: "uncommitted" })).toBe(
      "pier.git.changes.uncommitted"
    );
    expect(
      gitChangesPanelTabIconId({
        kind: "commit",
        oid: "abcdef0123456789abcdef0123456789abcdef01",
      })
    ).toBe("pier.git.changes.commit");
    expect(
      gitChangesPanelTabIconId({ kind: "branch", ref: "refs/heads/main" })
    ).toBe("pier.git.changes.branch");
  });
});

describe("gitChangesPanelTabChrome", () => {
  it("returns title and tooltip from params source", () => {
    const chrome = gitChangesPanelTabChrome(
      {
        context: {
          branch: "main",
          contextId: "worktree:repo",
          projectRootPath: "/repo",
          updatedAt: 1,
        },
        source: {
          contextId: "worktree:repo",
          gitRootPath: "/repo",
          target: { kind: "uncommitted" },
        },
      },
      LABELS
    );

    expect(chrome).toEqual({
      icon: { id: "pier.git.changes.uncommitted" },
      title: "repo",
      tooltip: {
        lines: [
          { label: "Path", value: "/repo" },
          { label: "Branch", value: "main" },
          { label: "Target", value: "Uncommitted" },
        ],
        title: "Changes · repo",
      },
    });
  });

  it("sets scope-specific tab icons for commit and branch targets", () => {
    expect(
      gitChangesPanelTabChrome(
        {
          source: {
            contextId: "worktree:repo",
            gitRootPath: "/repo",
            target: {
              kind: "commit",
              oid: "abcdef0123456789abcdef0123456789abcdef01",
            },
          },
        },
        LABELS
      )?.icon
    ).toEqual({ id: "pier.git.changes.commit" });

    expect(
      gitChangesPanelTabChrome(
        {
          source: {
            contextId: "worktree:repo",
            gitRootPath: "/repo",
            target: { kind: "branch", ref: "refs/heads/main" },
          },
        },
        LABELS
      )?.icon
    ).toEqual({ id: "pier.git.changes.branch" });
  });

  it("attaches git-line-delta trailing from tabChangeSummary param", () => {
    const chrome = gitChangesPanelTabChrome(
      {
        source: {
          contextId: "worktree:repo",
          gitRootPath: "/repo",
          target: { kind: "uncommitted" },
        },
        [GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM]: {
          changedFiles: 2,
          deletions: 3,
          excludedFiles: 0,
          insertions: 12,
          kind: "lineDelta",
        },
      },
      LABELS
    );

    expect(chrome?.trailing).toEqual({
      deletions: 3,
      insertions: 12,
      kind: "git-line-delta",
    });
    expect(chrome?.title).toBe("repo");
  });

  it("omits trailing for zero lineDelta or filesOnly summary", () => {
    expect(
      gitChangesPanelTabChrome(
        {
          source: {
            contextId: "worktree:repo",
            gitRootPath: "/repo",
            target: { kind: "uncommitted" },
          },
          [GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM]: {
            changedFiles: 0,
            deletions: 0,
            excludedFiles: 0,
            insertions: 0,
            kind: "lineDelta",
          },
        },
        LABELS
      )?.trailing
    ).toBeUndefined();

    expect(
      gitChangesPanelTabChrome(
        {
          source: {
            contextId: "worktree:repo",
            gitRootPath: "/repo",
            target: { kind: "uncommitted" },
          },
          [GIT_CHANGES_TAB_CHANGE_SUMMARY_PARAM]: {
            changedFiles: 2,
            kind: "filesOnly",
            omittedFiles: 2,
            reasons: ["tooLarge"],
          },
        },
        LABELS
      )?.trailing
    ).toBeUndefined();
  });

  it("returns undefined without a valid source", () => {
    expect(gitChangesPanelTabChrome({}, LABELS)).toBeUndefined();
  });
});

describe("gitReviewTabChangeSummary", () => {
  it("merges unstaged and staged lineDelta for uncommitted target", () => {
    expect(
      gitReviewTabChangeSummary(
        { kind: "uncommitted" },
        {
          staged: {
            changedFiles: 1,
            deletions: 1,
            excludedFiles: 0,
            insertions: 2,
            kind: "lineDelta",
          },
          unstaged: {
            changedFiles: 2,
            deletions: 4,
            excludedFiles: 0,
            insertions: 10,
            kind: "lineDelta",
          },
        }
      )
    ).toEqual({
      changedFiles: 3,
      deletions: 5,
      excludedFiles: 0,
      insertions: 12,
      kind: "lineDelta",
    });
  });

  it("uses committed summary for commit target", () => {
    expect(
      gitReviewTabChangeSummary(
        {
          kind: "commit",
          oid: "abcdef0123456789abcdef0123456789abcdef01",
        },
        {
          committed: {
            changedFiles: 1,
            deletions: 2,
            excludedFiles: 0,
            insertions: 5,
            kind: "lineDelta",
          },
        }
      )
    ).toEqual({
      changedFiles: 1,
      deletions: 2,
      excludedFiles: 0,
      insertions: 5,
      kind: "lineDelta",
    });
  });
});

describe("gitLineDeltaTrailingFromSummary", () => {
  it("returns trailing only for non-zero lineDelta", () => {
    expect(
      gitLineDeltaTrailingFromSummary({
        changedFiles: 1,
        deletions: 0,
        excludedFiles: 0,
        insertions: 4,
        kind: "lineDelta",
      })
    ).toEqual({ deletions: 0, insertions: 4, kind: "git-line-delta" });
    expect(
      gitLineDeltaTrailingFromSummary({
        changedFiles: 0,
        deletions: 0,
        excludedFiles: 0,
        insertions: 0,
        kind: "lineDelta",
      })
    ).toBeUndefined();
  });
});
