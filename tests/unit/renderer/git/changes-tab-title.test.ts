import {
  gitChangesPanelTabChrome,
  gitChangesPanelTitle,
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

  it("returns undefined without a valid source", () => {
    expect(gitChangesPanelTabChrome({}, LABELS)).toBeUndefined();
  });
});
