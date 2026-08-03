import type {
  GitStatusDropdownModel,
  GitStatusDropdownText,
} from "@plugins/builtin/git/renderer/status-dropdown-model.ts";
import {
  deriveGitStatusDropdownModel,
  GIT_LARGE_CHANGE_FILE_THRESHOLD,
  GIT_LARGE_CHANGE_LINE_THRESHOLD,
  resolveRemoteSyncActionId,
} from "@plugins/builtin/git/renderer/status-dropdown-model.ts";
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
  abortOperation: (operation) => `中止${operation}`,
  ahead: "领先",
  behind: "落后",
  changes: "更改",
  conflict: (count) => `${count} 个冲突`,
  continueOperation: (operation) => `继续${operation}`,
  deletions: "行删除",
  insertions: "行新增",
  largeChange: "变更规模较大",
  merged: "已合并",
  noLocalChanges: "无未提交变更",
  noUpstream: "无上游分支",
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
  pull: "拉取",
  pullBlocked: "本地有改动，请先提交或储藏再拉取",
  push: "推送",
  stash: "储藏",
  sync: "同步",
  upstreamGone: "远端已删",
};

function makeStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  const counts = {
    conflict: 0,
    modified: 0,
    staged: 0,
    untracked: 0,
    ...overrides.counts,
  };
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
    changeSummary: overrides.changeSummary ?? {
      changedFiles:
        counts.conflict + counts.modified + counts.staged + counts.untracked,
      deletions: 0,
      excludedFiles: 0,
      insertions: 0,
      kind: "lineDelta",
    },
    counts,
    files: [],
    remoteSync: null,
    repoState: { kind: "clean" },
    stashCount: 0,
    ...overrides,
  };
}

function derive(
  status: GitStatus,
  options: Partial<Parameters<typeof deriveGitStatusDropdownModel>[2]> = {}
): GitStatusDropdownModel {
  return deriveGitStatusDropdownModel(status, PANEL_CONTEXT, {
    fallbackWorktreeName: "pier",
    worktreePath: "/workspace/pier",
    ...options,
  });
}

function rowIds(model: GitStatusDropdownModel): string[] {
  return model.rows.map((row) => row.id);
}

function row(model: GitStatusDropdownModel, id: string) {
  const match = model.rows.find((candidate) => candidate.id === id);
  if (!match) {
    throw new Error(`expected row ${id}`);
  }
  return match;
}

describe("deriveGitStatusDropdownModel", () => {
  it("offers view changes first only for a clean repository without local changes", () => {
    const clean = derive(makeStatus());
    const dirty = derive(
      makeStatus({
        counts: { conflict: 0, modified: 1, staged: 0, untracked: 0 },
      })
    );
    const paused = derive(
      makeStatus({
        repoState: { conflictCount: 0, current: 1, kind: "rebasing", total: 2 },
      })
    );

    expect(clean.tasks.map((task) => task.id)).toEqual([
      "viewChanges",
      "switchBranch",
      "switchWorktree",
    ]);
    expect(row(clean, "clean").action).toBeNull();
    expect(dirty.tasks.map((task) => task.id)).not.toContain("viewChanges");
    expect(paused.tasks.map((task) => task.id)).not.toContain("viewChanges");
  });

  it("keeps the fixed task zone in every normal model", () => {
    for (const status of [
      makeStatus(),
      makeStatus({
        counts: { conflict: 0, modified: 3, staged: 1, untracked: 0 },
      }),
      makeStatus({
        counts: { conflict: 2, modified: 0, staged: 0, untracked: 0 },
        repoState: { conflictCount: 2, current: 1, kind: "rebasing", total: 4 },
      }),
    ]) {
      const model = derive(status);
      expect(model.variant).toBe("normal");
      expect(model.tasks.map((task) => task.id).slice(-2)).toEqual([
        "switchBranch",
        "switchWorktree",
      ]);
    }
  });

  it("models tracked dirty changes as a single actionable changes row", () => {
    const model = derive(
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
        changeSummary: {
          changedFiles: 7,
          deletions: 42,
          excludedFiles: 0,
          insertions: 128,
          kind: "lineDelta",
        },
      }),
      { remoteSyncLabel: "Remote fetched 1 min ago" }
    );

    expect(rowIds(model)).toEqual(["changes", "sync"]);
    const changes = row(model, "changes");
    expect(changes.action).toBe("viewChanges");
    expect(changes.value).toBe("7");
    expect(changes.lineDelta).toEqual({ deletions: 42, insertions: 128 });
    expect(changes.tone).toBe("default");
    expect(model.contextLine).toBe("pier · Remote fetched 1 min ago");
  });

  it("uses the canonical unique file count when line totals are unavailable", () => {
    const model = derive(
      makeStatus({
        changeSummary: {
          changedFiles: 1,
          kind: "filesOnly",
          omittedFiles: 1,
          reasons: ["invalidEncoding"],
        },
        // MM 同时进入两个分类，但仍然只是一个文件。
        counts: { conflict: 0, modified: 1, staged: 1, untracked: 0 },
      })
    );

    expect(row(model, "changes").value).toBe("1");
  });

  it("escalates the changes row for large changes", () => {
    const byFiles = derive(
      makeStatus({
        counts: {
          conflict: 0,
          modified: GIT_LARGE_CHANGE_FILE_THRESHOLD,
          staged: 0,
          untracked: 0,
        },
      })
    );
    expect(row(byFiles, "changes").tone).toBe("warning");
    expect(row(byFiles, "changes").title).toBeTruthy();

    const byLines = derive(
      makeStatus({
        counts: { conflict: 0, modified: 1, staged: 0, untracked: 0 },
        changeSummary: {
          changedFiles: 1,
          deletions: 0,
          excludedFiles: 0,
          insertions: GIT_LARGE_CHANGE_LINE_THRESHOLD,
          kind: "lineDelta",
        },
      })
    );
    expect(row(byLines, "changes").tone).toBe("warning");
  });

  it("offers push when the branch is only ahead of its upstream", () => {
    const model = derive(
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
    );
    const sync = row(model, "sync");
    expect(sync.action).toBe("push");
    expect(sync.label).toBe("Push");
    expect(sync.value).toBe("↑2");
  });

  it("offers pull when the clean branch is only behind its upstream", () => {
    const model = derive(
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
    );
    const sync = row(model, "sync");
    expect(sync.action).toBe("pull");
    expect(sync.value).toBe("↓3");
  });

  it("offers sync when the clean branch is both ahead and behind", () => {
    const model = derive(
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
    );
    const sync = row(model, "sync");
    expect(sync.action).toBe("syncChanges");
    expect(sync.value).toBe("↑2 ↓3");
  });

  it("keeps the sync row visible but inert when local changes block pull", () => {
    const model = derive(
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
    );
    const sync = row(model, "sync");
    expect(sync.action).toBeNull();
    expect(sync.tone).toBe("muted");
    expect(sync.title).toBe("Commit or stash local changes before pulling");
    expect(sync.value).toBe("↓2");
  });

  it("does not offer sync operations without a usable upstream", () => {
    expect(
      resolveRemoteSyncActionId(
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
    ).toBeNull();
    expect(
      resolveRemoteSyncActionId(
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
    ).toBeNull();
  });

  it("puts paused rebase with continue and abort rows on top", () => {
    const model = derive(
      makeStatus({
        counts: { conflict: 3, modified: 0, staged: 0, untracked: 0 },
        repoState: {
          conflictCount: 3,
          current: 2,
          kind: "rebasing",
          total: 5,
        },
      })
    );

    expect(rowIds(model)).toEqual([
      "operation",
      "continueOperation",
      "abortOperation",
    ]);
    expect(model.operationKind).toBe("rebasing");
    const operation = row(model, "operation");
    expect(operation.label).toBe("Rebase paused");
    expect(operation.value).toBe("3 conflicts");
    expect(operation.tone).toBe("danger");
    expect(operation.action).toBe("viewChanges");
    expect(row(model, "continueOperation").label).toBe("Continue Rebase");
    expect(row(model, "abortOperation").label).toBe("Abort Rebase");
  });

  it("uses singular conflict copy for one active conflict", () => {
    const model = derive(
      makeStatus({
        counts: { conflict: 1, modified: 0, staged: 0, untracked: 0 },
        repoState: {
          conflictCount: 1,
          current: 2,
          kind: "rebasing",
          total: 5,
        },
      })
    );

    expect(row(model, "operation").value).toBe("1 conflict");
  });

  it("offers abort but no continue for a paused merge", () => {
    const model = derive(
      makeStatus({
        counts: { conflict: 2, modified: 0, staged: 0, untracked: 0 },
        repoState: { conflictCount: 2, kind: "merging" },
      })
    );

    expect(rowIds(model)).toEqual(["operation", "abortOperation"]);
    expect(model.operationKind).toBe("merging");
    expect(row(model, "abortOperation").label).toBe("Abort Merge");
  });

  it("keeps bisect informational without continue or abort rows", () => {
    const model = derive(
      makeStatus({
        repoState: { bad: 2, good: 3, kind: "bisecting" },
      })
    );

    expect(rowIds(model)).toEqual(["operation"]);
    expect(model.operationKind).toBeNull();
    expect(row(model, "operation").tone).toBe("default");
  });

  it("hides the sync row while an operation is paused", () => {
    const model = derive(
      makeStatus({
        branch: {
          ahead: 2,
          behind: 1,
          branch: "feature/rebase",
          mergedIntoDefault: null,
          oid: "abc1234567",
          upstream: "origin/feature/rebase",
          upstreamGone: false,
        },
        repoState: { conflictCount: 0, current: 1, kind: "rebasing", total: 3 },
      })
    );

    expect(rowIds(model)).not.toContain("sync");
  });

  it("models clean merged upstream-gone branch as muted lifecycle rows", () => {
    const model = derive(
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
      })
    );

    expect(rowIds(model)).toEqual(["clean", "merged", "upstreamGone"]);
    expect(row(model, "merged").action).toBeNull();
    expect(row(model, "merged").tone).toBe("muted");
    expect(row(model, "upstreamGone").tone).toBe("muted");
  });

  it("flags a branch without upstream as a muted info row", () => {
    const model = derive(
      makeStatus({
        branch: {
          ahead: 0,
          behind: 0,
          branch: "feature/local-only",
          mergedIntoDefault: null,
          oid: "abc1234567",
          upstream: null,
          upstreamGone: false,
        },
      })
    );

    expect(rowIds(model)).toEqual(["clean", "noUpstream"]);
    expect(row(model, "noUpstream").action).toBeNull();
  });

  it("shows the stash count as an informational row", () => {
    const model = derive(makeStatus({ stashCount: 3 }));

    const stash = row(model, "stash");
    expect(stash.action).toBeNull();
    expect(stash.value).toBe("3");
  });

  it("does not treat zero line delta as dirty", () => {
    const model = derive(
      makeStatus({
        changeSummary: {
          changedFiles: 0,
          deletions: 0,
          excludedFiles: 0,
          insertions: 0,
          kind: "lineDelta",
        },
      })
    );

    expect(rowIds(model)).toEqual(["clean"]);
    expect(row(model, "clean").action).toBeNull();
  });

  it("完整行统计的下拉行同时保留新增和删除零值", () => {
    const model = derive(
      makeStatus({
        changeSummary: {
          changedFiles: 1,
          deletions: 3,
          excludedFiles: 0,
          insertions: 0,
          kind: "lineDelta",
        },
        counts: { conflict: 0, modified: 1, staged: 0, untracked: 0 },
      })
    );

    expect(row(model, "changes").value).toBe("1");
    expect(row(model, "changes").lineDelta).toEqual({
      deletions: 3,
      insertions: 0,
    });
    expect(row(model, "changes").assistiveLabel).toBe(
      "0 insertions, 3 deletions"
    );
  });

  it("全 excluded 的 lineDelta 下拉行不拼 +0 −0", () => {
    const model = derive(
      makeStatus({
        changeSummary: {
          changedFiles: 2,
          deletions: 0,
          excludedFiles: 2,
          insertions: 0,
          kind: "lineDelta",
        },
        counts: { conflict: 0, modified: 0, staged: 0, untracked: 2 },
      })
    );

    expect(row(model, "changes").value).toBe("2");
    expect(row(model, "changes").lineDelta).toBeUndefined();
    expect(row(model, "changes").assistiveLabel).toBeUndefined();
  });

  it("formats rows with injected localized text", () => {
    const model = derive(
      makeStatus({
        counts: { conflict: 0, modified: 1, staged: 0, untracked: 0 },
        changeSummary: {
          changedFiles: 1,
          deletions: 1,
          excludedFiles: 0,
          insertions: 2,
          kind: "lineDelta",
        },
      }),
      { text: ZH_TEXT }
    );

    const changes = row(model, "changes");
    expect(changes.label).toBe("更改");
    expect(changes.value).toBe("1");
    expect(changes.lineDelta).toEqual({ deletions: 1, insertions: 2 });
    expect(changes.assistiveLabel).toBe("2 行新增, 1 行删除");
  });

  it("localizes operation rows with injected text", () => {
    const model = derive(
      makeStatus({
        counts: { conflict: 2, modified: 0, staged: 0, untracked: 0 },
        repoState: { conflictCount: 2, kind: "cherry-picking" },
      }),
      { text: ZH_TEXT }
    );

    expect(row(model, "operation").label).toBe("拣选已暂停");
    expect(row(model, "continueOperation").label).toBe("继续拣选");
    expect(row(model, "abortOperation").label).toBe("中止拣选");
  });
});
