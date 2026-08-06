import {
  GIT_FETCH_TASK_STALE_MS,
  resolveRemoteSyncActionId,
  resolveRemoteSyncActionIdForChrome,
  shouldOfferFetchTask,
} from "@plugins/builtin/git/renderer/remote-sync-policy.ts";
import type {
  GitStatusDropdownModel,
  GitStatusDropdownText,
} from "@plugins/builtin/git/renderer/status-dropdown-model.ts";
import {
  deriveGitStatusDropdownModel,
  GIT_LARGE_CHANGE_FILE_THRESHOLD,
  GIT_LARGE_CHANGE_LINE_THRESHOLD,
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
  authBlocked: "无法通过远程身份验证",
  behind: "落后",
  changes: "更改",
  conflict: (count) => `${count} 个冲突`,
  continueOperation: (operation) => `继续${operation}`,
  deletions: "行删除",
  detachedBlocked: "当前不在任何分支上",
  fetch: "获取远程更新",
  fetchDetail: "刷新远程分支数据",
  insertions: "行新增",
  largeChange: "变更规模较大",
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
  publish: "发布分支",
  publishDetail: "推送到远程并设置上游分支",
  pull: "拉取",
  pullBlocked: "本地有改动，请先提交或储藏再拉取",
  push: "推送",
  republish: "重新发布分支",
  republishDetail: "远程分支已删除，请重新发布",
  stash: "储藏",
  sync: "同步",
  syncUnavailable: "当前无法进行远程同步",
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
    gitRoot: "/workspace/pier",
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
    // Fresh remote snapshot: fetch is not a permanent task.
    const clean = derive(
      makeStatus({
        remoteSync: { lastSuccessAt: Date.now(), state: "idle" },
      })
    );
    const dirty = derive(
      makeStatus({
        counts: { conflict: 0, modified: 1, staged: 0, untracked: 0 },
        remoteSync: { lastSuccessAt: Date.now(), state: "idle" },
      })
    );
    const paused = derive(
      makeStatus({
        remoteSync: { lastSuccessAt: Date.now(), state: "idle" },
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

  it("keeps branch/worktree navigation tasks in every normal model", () => {
    for (const status of [
      makeStatus({
        remoteSync: { lastSuccessAt: Date.now(), state: "idle" },
      }),
      makeStatus({
        counts: { conflict: 0, modified: 3, staged: 1, untracked: 0 },
        remoteSync: { lastSuccessAt: Date.now(), state: "idle" },
      }),
      makeStatus({
        counts: { conflict: 2, modified: 0, staged: 0, untracked: 0 },
        remoteSync: { lastSuccessAt: Date.now(), state: "idle" },
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

  it("offers publish when the branch has no upstream or upstream is gone", () => {
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
    ).toBe("publish");
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
    ).toBe("publish");
  });

  it("maps in-sync branches to fetch decision, but chrome hides fetch when fresh", () => {
    expect(resolveRemoteSyncActionId(makeStatus())).toBe("fetch");
    expect(
      resolveRemoteSyncActionIdForChrome(
        makeStatus({
          remoteSync: { lastSuccessAt: Date.now(), state: "idle" },
        })
      )
    ).toBeNull();
    expect(
      resolveRemoteSyncActionIdForChrome(makeStatus({ remoteSync: null }))
    ).toBe("fetch");
  });

  it("keeps fetch chrome while remoteSync is fetching or local busy is set", () => {
    const now = 1_800_000_000_000;
    const freshIdle = makeStatus({
      remoteSync: { lastSuccessAt: now - 60_000, state: "idle" },
    });
    // Fresh idle: hide chrome (Model A).
    expect(resolveRemoteSyncActionIdForChrome(freshIdle, now)).toBeNull();
    // Same snapshot but local trackSync still busy: keep chrome identity.
    expect(
      resolveRemoteSyncActionIdForChrome(freshIdle, now, { busy: true })
    ).toBe("fetch");

    // In-flight remote record: task list hides a second entry, chrome keeps fetch.
    const fetching = makeStatus({
      remoteSync: { lastSuccessAt: null, state: "fetching" },
    });
    expect(shouldOfferFetchTask(fetching, now)).toBe(false);
    expect(resolveRemoteSyncActionIdForChrome(fetching, now)).toBe("fetch");
    expect(
      resolveRemoteSyncActionIdForChrome(fetching, now, { busy: true })
    ).toBe("fetch");

    // Fetching with a prior success timestamp must not strip chrome either.
    const fetchingAfterSuccess = makeStatus({
      remoteSync: { lastSuccessAt: now - 60_000, state: "fetching" },
    });
    expect(shouldOfferFetchTask(fetchingAfterSuccess, now)).toBe(false);
    expect(resolveRemoteSyncActionIdForChrome(fetchingAfterSuccess, now)).toBe(
      "fetch"
    );
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

  it("models clean merged upstream-gone branch with republish action", () => {
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

    expect(rowIds(model)).toEqual(["clean", "sync", "merged"]);
    expect(row(model, "merged").action).toBeNull();
    expect(row(model, "merged").tone).toBe("muted");
    expect(row(model, "sync").action).toBe("publish");
    expect(row(model, "sync").label).toBe("Publish Branch Again");
  });

  it("offers a clickable publish row when the branch has no upstream", () => {
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

    expect(rowIds(model)).toEqual(["clean", "sync"]);
    const sync = row(model, "sync");
    expect(sync.action).toBe("publish");
    expect(sync.label).toBe("Publish Branch");
    expect(sync.title).toBe("Push to the remote and set the upstream branch");
  });

  it("offers republish when upstream is gone", () => {
    const model = derive(
      makeStatus({
        branch: {
          ahead: 0,
          behind: 0,
          branch: "feature/gone",
          mergedIntoDefault: null,
          oid: "abc1234567",
          upstream: "origin/feature/gone",
          upstreamGone: true,
        },
      })
    );
    const sync = row(model, "sync");
    expect(sync.action).toBe("publish");
    expect(sync.label).toBe("Publish Branch Again");
  });

  it("does not put fetch on the sync row when already in sync", () => {
    const model = derive(
      makeStatus({
        remoteSync: { lastSuccessAt: Date.now(), state: "idle" },
      })
    );
    expect(rowIds(model)).toEqual(["clean"]);
    expect(model.tasks.map((t) => t.id)).not.toContain("fetch");
    expect(resolveRemoteSyncActionId(makeStatus())).toBe("fetch");
  });

  it("offers fetch task only when remote snapshot is missing, untrusted, or stale", () => {
    const now = 1_800_000_000_000;
    expect(shouldOfferFetchTask(makeStatus({ remoteSync: null }), now)).toBe(
      true
    );
    expect(
      shouldOfferFetchTask(
        makeStatus({
          remoteSync: { lastSuccessAt: null, state: "idle" },
        }),
        now
      )
    ).toBe(true);
    expect(
      shouldOfferFetchTask(
        makeStatus({
          remoteSync: { lastSuccessAt: now - 60_000, state: "authRequired" },
        }),
        now
      )
    ).toBe(true);
    expect(
      shouldOfferFetchTask(
        makeStatus({
          remoteSync: {
            lastSuccessAt: now - GIT_FETCH_TASK_STALE_MS - 1,
            state: "idle",
          },
        }),
        now
      )
    ).toBe(true);
    expect(
      shouldOfferFetchTask(
        makeStatus({
          remoteSync: { lastSuccessAt: now - 60_000, state: "idle" },
        }),
        now
      )
    ).toBe(false);
    expect(
      shouldOfferFetchTask(
        makeStatus({
          remoteSync: { lastSuccessAt: now - 60_000, state: "fetching" },
        }),
        now
      )
    ).toBe(false);

    const neverModel = derive(makeStatus({ remoteSync: null }));
    expect(neverModel.tasks.map((t) => t.id)).toContain("fetch");

    const freshModel = derive(
      makeStatus({
        remoteSync: { lastSuccessAt: Date.now(), state: "idle" },
      })
    );
    expect(freshModel.tasks.map((t) => t.id)).not.toContain("fetch");
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
        remoteSync: { lastSuccessAt: Date.now(), state: "idle" },
      })
    );

    // 已同步且远程新鲜：同步行不占位；Fetch 不进任务区
    expect(rowIds(model)).toEqual(["clean"]);
    expect(row(model, "clean").action).toBeNull();
    expect(model.tasks.map((t) => t.id)).not.toContain("fetch");
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
