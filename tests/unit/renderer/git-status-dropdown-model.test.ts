import type {
  GitStatusDropdownModel,
  GitStatusDropdownText,
} from "@plugins/builtin/git/renderer/git-status-dropdown-model.ts";
import { deriveGitStatusDropdownModel } from "@plugins/builtin/git/renderer/git-status-dropdown-model.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { describe, expect, it } from "vitest";

const PANEL_CONTEXT = {
  branch: "main",
  contextId: "ctx-pier",
  cwd: "/workspace/pier",
  gitRoot: "/workspace/pier",
  openedPath: "/workspace/pier",
  projectRootPath: "/workspace/pier",
  source: "panel",
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/workspace/pier",
  worktreeRoot: "/workspace/pier",
} as const satisfies PanelContext;

const ZH_TEXT: GitStatusDropdownText = {
  ahead: "领先",
  behind: "落后",
  changed: (count) => `${count} 项变更`,
  conflict: (count) => `${count} 个冲突`,
  deletions: "行删除",
  insertions: "行新增",
  merged: "已合并",
  noLocalChanges: "无未提交变更",
  operationName: (kind) => {
    const names = {
      bisecting: "二分查找",
      "cherry-picking": "拣选",
      merging: "合并",
      rebasing: "变基",
      reverting: "还原",
    } as const;
    return names[kind];
  },
  operationPaused: (operation) => `${operation}已暂停`,
  upstreamGone: "远端已删",
};

function makeStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: {
      ahead: 0,
      behind: 0,
      branch: "main",
      mergedIntoDefault: null,
      oid: "abc1234567",
      upstream: "origin/main",
      upstreamGone: false,
      ...overrides.branch,
    },
    counts: {
      conflict: 0,
      modified: 0,
      staged: 0,
      untracked: 0,
      ...overrides.counts,
    },
    delta: null,
    files: [],
    remoteSync: null,
    repoState: { kind: "clean" },
    stashCount: 0,
    ...overrides,
  };
}

function actionIds(status: GitStatus): string[] {
  return deriveGitStatusDropdownModel(status, PANEL_CONTEXT, {
    fallbackWorktreeName: "pier",
    worktreePath: "/workspace/pier",
  }).actions.map((action) => action.id);
}

function summaryText(model: GitStatusDropdownModel): string {
  return model.statusGroups
    .map((group) => group.parts.map((part) => part.label).join(" "))
    .join(" · ");
}

describe("deriveGitStatusDropdownModel", () => {
  it("models tracked dirty changes with review and switch-worktree actions", () => {
    const model = deriveGitStatusDropdownModel(
      makeStatus({
        branch: {
          ahead: 2,
          behind: 1,
          branch: "feature/terminal-status",
          mergedIntoDefault: null,
          oid: "abc1234567",
          upstream: "origin/feature/terminal-status",
          upstreamGone: false,
        },
        counts: { conflict: 0, modified: 4, staged: 2, untracked: 1 },
        delta: { deletions: 42, insertions: 128 },
      }),
      PANEL_CONTEXT,
      {
        fallbackWorktreeName: "pier",
        remoteSyncLabel: "Remote fetched 1 min ago",
        worktreePath: "/workspace/pier",
      }
    );

    expect(model.variant).toBe("dirty");
    expect(model.actions.map((action) => action.id)).toEqual([
      "switchWorktree",
    ]);
    expect(summaryText(model)).toContain("7 changed");
    expect(summaryText(model)).toContain("+128 −42");
    expect(summaryText(model)).toContain("↑2 ↓1");
    expect(model.statusGroups).toEqual([
      { parts: [{ icon: "changed", label: "7 changed", tone: "warning" }] },
      {
        parts: [
          { assistiveLabel: "insertions", label: "+128", tone: "success" },
          {
            assistiveLabel: "deletions",
            label: "−42",
            tone: "destructive",
          },
        ],
      },
      {
        parts: [
          {
            assistiveLabel: "ahead",
            icon: "ahead",
            label: "↑2",
            tone: "muted",
          },
          {
            assistiveLabel: "behind",
            icon: "behind",
            label: "↓1",
            tone: "muted",
          },
        ],
      },
    ]);
    expect(model.contextLine).toBe("pier · Remote fetched 1 min ago");
  });

  it("offers push when the branch is only ahead of its upstream", () => {
    expect(
      actionIds(
        makeStatus({
          branch: {
            ahead: 2,
            behind: 0,
            branch: "feature/ahead-only",
            mergedIntoDefault: null,
            oid: "abc1234567",
            upstream: "origin/feature/ahead-only",
            upstreamGone: false,
          },
        })
      )
    ).toEqual(["push", "switchBranch", "switchWorktree"]);
  });

  it("offers pull when the clean branch is only behind its upstream", () => {
    expect(
      actionIds(
        makeStatus({
          branch: {
            ahead: 0,
            behind: 3,
            branch: "feature/behind-only",
            mergedIntoDefault: null,
            oid: "abc1234567",
            upstream: "origin/feature/behind-only",
            upstreamGone: false,
          },
        })
      )
    ).toEqual(["pull", "switchBranch", "switchWorktree"]);
  });

  it("offers sync when the clean branch is both ahead and behind", () => {
    expect(
      actionIds(
        makeStatus({
          branch: {
            ahead: 2,
            behind: 3,
            branch: "feature/sync",
            mergedIntoDefault: null,
            oid: "abc1234567",
            upstream: "origin/feature/sync",
            upstreamGone: false,
          },
        })
      )
    ).toEqual(["syncChanges", "switchBranch", "switchWorktree"]);
  });

  it("does not offer pull or sync when local changes could be disturbed", () => {
    expect(
      actionIds(
        makeStatus({
          branch: {
            ahead: 0,
            behind: 2,
            branch: "feature/dirty-behind",
            mergedIntoDefault: null,
            oid: "abc1234567",
            upstream: "origin/feature/dirty-behind",
            upstreamGone: false,
          },
          counts: { conflict: 0, modified: 2, staged: 1, untracked: 2 },
        })
      )
    ).toEqual(["switchWorktree"]);
    expect(
      actionIds(
        makeStatus({
          branch: {
            ahead: 2,
            behind: 2,
            branch: "feature/dirty-diverged",
            mergedIntoDefault: null,
            oid: "abc1234567",
            upstream: "origin/feature/dirty-diverged",
            upstreamGone: false,
          },
          counts: { conflict: 0, modified: 1, staged: 0, untracked: 0 },
        })
      )
    ).toEqual(["switchWorktree"]);
  });

  it("does not offer sync operations without a usable upstream", () => {
    expect(
      actionIds(
        makeStatus({
          branch: {
            ahead: 2,
            behind: 0,
            branch: "feature/no-upstream",
            mergedIntoDefault: null,
            oid: "abc1234567",
            upstream: null,
            upstreamGone: false,
          },
        })
      )
    ).toEqual(["switchBranch", "switchWorktree"]);
    expect(
      actionIds(
        makeStatus({
          branch: {
            ahead: 2,
            behind: 0,
            branch: "feature/upstream-gone",
            mergedIntoDefault: null,
            oid: "abc1234567",
            upstream: "origin/feature/upstream-gone",
            upstreamGone: true,
          },
        })
      )
    ).toEqual(["switchBranch", "switchWorktree"]);
  });

  it("models rebasing conflicts without write actions", () => {
    const model = deriveGitStatusDropdownModel(
      makeStatus({
        counts: { conflict: 3, modified: 0, staged: 0, untracked: 0 },
        repoState: {
          conflictCount: 3,
          current: 2,
          kind: "rebasing",
          total: 5,
        },
      }),
      PANEL_CONTEXT,
      {
        fallbackWorktreeName: "pier",
        worktreePath: "/workspace/pier",
      }
    );

    expect(model.variant).toBe("active");
    expect(model.actions.map((action) => action.id)).toEqual([
      "switchWorktree",
    ]);
    expect(summaryText(model)).toContain("Rebase paused");
    expect(summaryText(model)).toContain("3 conflicts");
    expect(model.statusGroups).toEqual([
      { parts: [{ icon: "rebase", label: "Rebase paused", tone: "info" }] },
      { parts: [{ icon: "conflict", label: "3 conflicts", tone: "danger" }] },
    ]);
  });

  it("uses singular conflict copy for one active conflict", () => {
    const model = deriveGitStatusDropdownModel(
      makeStatus({
        counts: { conflict: 1, modified: 0, staged: 0, untracked: 0 },
        repoState: {
          conflictCount: 1,
          current: 2,
          kind: "rebasing",
          total: 5,
        },
      }),
      PANEL_CONTEXT,
      {
        fallbackWorktreeName: "pier",
        worktreePath: "/workspace/pier",
      }
    );

    expect(summaryText(model)).toContain("1 conflict");
    expect(summaryText(model)).not.toContain("1 conflicts");
  });

  it("models cherry-pick pause as review-only", () => {
    expect(
      actionIds(
        makeStatus({
          counts: { conflict: 2, modified: 0, staged: 0, untracked: 0 },
          repoState: { conflictCount: 2, kind: "cherry-picking" },
        })
      )
    ).toEqual(["switchWorktree"]);
  });

  it("models clean merged upstream-gone branch without prune", () => {
    const model = deriveGitStatusDropdownModel(
      makeStatus({
        branch: {
          ahead: 0,
          behind: 0,
          branch: "feature/auth-flow",
          mergedIntoDefault: true,
          oid: "abc1234567",
          upstream: "origin/feature/auth-flow",
          upstreamGone: true,
        },
      }),
      PANEL_CONTEXT,
      {
        fallbackWorktreeName: "pier",
        worktreePath: "/workspace/pier",
      }
    );

    expect(model.variant).toBe("completed");
    expect(model.actions.map((action) => action.id)).toEqual([
      "switchBranch",
      "switchWorktree",
    ]);
    expect(summaryText(model)).toBe(
      "No local changes · merged · upstream gone"
    );
    expect(model.statusGroups).toEqual([
      {
        parts: [{ icon: "clean", label: "No local changes", tone: "default" }],
      },
      { parts: [{ icon: "merged", label: "merged", tone: "done" }] },
      {
        parts: [
          { icon: "upstreamGone", label: "upstream gone", tone: "warning" },
        ],
      },
    ]);
  });

  it("keeps sync counts visible when the working tree is clean", () => {
    const model = deriveGitStatusDropdownModel(
      makeStatus({
        branch: {
          ahead: 2,
          behind: 3,
          branch: "feature/sync-only",
          mergedIntoDefault: null,
          oid: "abc1234567",
          upstream: "origin/feature/sync-only",
          upstreamGone: false,
        },
      }),
      PANEL_CONTEXT,
      {
        fallbackWorktreeName: "pier",
        worktreePath: "/workspace/pier",
      }
    );

    expect(model.variant).toBe("clean");
    expect(summaryText(model)).toBe("No local changes · ↑2 ↓3");
    expect(model.actions.map((action) => action.id)).toEqual([
      "syncChanges",
      "switchBranch",
      "switchWorktree",
    ]);
    expect(model.statusGroups).toEqual([
      {
        parts: [{ icon: "clean", label: "No local changes", tone: "default" }],
      },
      {
        parts: [
          {
            assistiveLabel: "ahead",
            icon: "ahead",
            label: "↑2",
            tone: "muted",
          },
          {
            assistiveLabel: "behind",
            icon: "behind",
            label: "↓3",
            tone: "muted",
          },
        ],
      },
    ]);
  });

  it("omits zero sync directions to match the status bar summary", () => {
    const aheadOnly = deriveGitStatusDropdownModel(
      makeStatus({
        branch: {
          ahead: 2,
          behind: 0,
          branch: "feature/ahead-only",
          mergedIntoDefault: null,
          oid: "abc1234567",
          upstream: "origin/feature/ahead-only",
          upstreamGone: false,
        },
      }),
      PANEL_CONTEXT,
      {
        fallbackWorktreeName: "pier",
        worktreePath: "/workspace/pier",
      }
    );
    const behindOnly = deriveGitStatusDropdownModel(
      makeStatus({
        branch: {
          ahead: 0,
          behind: 3,
          branch: "feature/behind-only",
          mergedIntoDefault: null,
          oid: "abc1234567",
          upstream: "origin/feature/behind-only",
          upstreamGone: false,
        },
      }),
      PANEL_CONTEXT,
      {
        fallbackWorktreeName: "pier",
        worktreePath: "/workspace/pier",
      }
    );

    expect(summaryText(aheadOnly)).toBe("No local changes · ↑2");
    expect(summaryText(aheadOnly)).not.toContain("↓0");
    expect(aheadOnly.statusGroups.at(1)).toEqual({
      parts: [
        {
          assistiveLabel: "ahead",
          icon: "ahead",
          label: "↑2",
          tone: "muted",
        },
      ],
    });
    expect(summaryText(behindOnly)).toBe("No local changes · ↓3");
    expect(summaryText(behindOnly)).not.toContain("↑0");
    expect(behindOnly.statusGroups.at(1)).toEqual({
      parts: [
        {
          assistiveLabel: "behind",
          icon: "behind",
          label: "↓3",
          tone: "muted",
        },
      ],
    });
  });

  it("does not treat zero line delta as dirty", () => {
    const model = deriveGitStatusDropdownModel(
      makeStatus({
        delta: { deletions: 0, insertions: 0 },
      }),
      PANEL_CONTEXT,
      {
        fallbackWorktreeName: "pier",
        worktreePath: "/workspace/pier",
      }
    );

    expect(model.variant).toBe("clean");
    expect(summaryText(model)).toBe("No local changes");
  });

  it("uses a differentiated clean summary instead of repeating the clean badge", () => {
    const model = deriveGitStatusDropdownModel(makeStatus(), PANEL_CONTEXT, {
      fallbackWorktreeName: "pier",
      worktreePath: "/workspace/pier",
    });

    expect(model.variant).toBe("clean");
    expect(summaryText(model)).toBe("No local changes");
    expect(summaryText(model)).not.toBe("Clean");
  });

  it("formats status lines with injected localized text", () => {
    const model = deriveGitStatusDropdownModel(
      makeStatus({
        counts: { conflict: 0, modified: 1, staged: 0, untracked: 0 },
        delta: { deletions: 1, insertions: 2 },
      }),
      PANEL_CONTEXT,
      {
        fallbackWorktreeName: "pier",
        text: ZH_TEXT,
        worktreePath: "/workspace/pier",
      }
    );

    expect(summaryText(model)).toBe("1 项变更 · +2 −1");
    expect(model.statusGroups).toEqual([
      { parts: [{ icon: "changed", label: "1 项变更", tone: "warning" }] },
      {
        parts: [
          { assistiveLabel: "行新增", label: "+2", tone: "success" },
          { assistiveLabel: "行删除", label: "−1", tone: "destructive" },
        ],
      },
    ]);
  });
});
