import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { submitGitCommit } from "@plugins/builtin/git/renderer/commit/submit.ts";
import {
  isSyncBusy,
  resetSyncBusyForTests,
  trackSync,
} from "@plugins/builtin/git/renderer/sync-busy.ts";
import type { GitStatus } from "@shared/contracts/git.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

function interpolate(
  template: string | undefined,
  values: Record<string, number | string> | undefined
): string {
  const base = template ?? "";
  if (!values) {
    return base;
  }
  return base.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

function gitStatus(overrides: Partial<GitStatus> = {}): GitStatus {
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
      changedFiles: 1,
      deletions: 0,
      excludedFiles: 0,
      insertions: 1,
      kind: "lineDelta",
    },
    counts: { conflict: 0, modified: 0, staged: 1, untracked: 0 },
    files: [{ index: "M", origPath: null, path: "src/a.ts", worktree: "." }],
    remoteSync: null,
    repoState: { kind: "clean" },
    stashCount: 0,
    ...overrides,
  };
}

function createContext(status: GitStatus): {
  alert: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  context: RendererPluginContext;
  publish: ReturnType<typeof vi.fn>;
  push: ReturnType<typeof vi.fn>;
  stage: ReturnType<typeof vi.fn>;
} {
  const commit = vi.fn(async () => true);
  const stage = vi.fn(async () => true);
  const push = vi.fn(async () => ({ kind: "ok" as const }));
  const publish = vi.fn(async () => ({ kind: "ok" as const }));
  const alert = vi.fn(async () => undefined);
  const context = {
    dialogs: { alert },
    git: {
      commit,
      getStatus: vi.fn(async () => status),
      publish,
      push,
      stage,
    },
    i18n: {
      t: (
        _key: string,
        values: Record<string, number | string> | undefined,
        fallback?: string
      ) => interpolate(fallback, values),
    },
  } as unknown as RendererPluginContext;
  return { alert, commit, context, publish, push, stage };
}

afterEach(() => {
  resetSyncBusyForTests();
});

describe("submitGitCommit", () => {
  it("stages submit-time unstaged paths when include was never toggled", async () => {
    const { context, stage } = createContext(
      gitStatus({
        counts: { conflict: 0, modified: 1, staged: 1, untracked: 0 },
        files: [
          { index: "M", origPath: null, path: "src/a.ts", worktree: "." },
          { index: ".", origPath: null, path: "src/c.ts", worktree: "M" },
        ],
      })
    );
    await submitGitCommit({
      context,
      cwd: "/repo",
      includeIntent: null,
      message: "wip",
      pushAfterPref: false,
      pushIntent: null,
    });
    expect(stage).toHaveBeenCalledWith("/repo", ["src/c.ts"]);
  });

  it("does not stage when the user turned include off", async () => {
    const { context, stage } = createContext(
      gitStatus({
        counts: { conflict: 0, modified: 1, staged: 1, untracked: 0 },
        files: [
          { index: "M", origPath: null, path: "src/a.ts", worktree: "." },
          { index: ".", origPath: null, path: "src/b.ts", worktree: "M" },
        ],
      })
    );
    await submitGitCommit({
      context,
      cwd: "/repo",
      includeIntent: false,
      message: "staged only",
      pushAfterPref: false,
      pushIntent: null,
    });
    expect(stage).not.toHaveBeenCalled();
  });

  it("alerts and skips push when a sync is already in flight", async () => {
    trackSync("/repo", () => new Promise(() => undefined));
    const { alert, context, publish, push } = createContext(gitStatus());
    await submitGitCommit({
      context,
      cwd: "/repo",
      includeIntent: null,
      message: "ship",
      pushAfterPref: true,
      pushIntent: null,
    });
    expect(publish).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Committed, but couldn't push",
      })
    );
  });

  it("occupies sync-busy while pushing after commit", async () => {
    let finish: (() => void) | undefined;
    const { context, publish } = createContext(gitStatus());
    publish.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({ kind: "ok" as const });
          };
        })
    );
    const done = submitGitCommit({
      context,
      cwd: "/repo",
      includeIntent: null,
      message: "ship",
      pushAfterPref: true,
      pushIntent: null,
    });
    await vi.waitFor(() => {
      expect(isSyncBusy("/repo")).toBe(true);
    });
    finish?.();
    await done;
    expect(isSyncBusy("/repo")).toBe(false);
  });

  it("alerts when the user wanted push but the snapshot cannot", async () => {
    const { alert, context, publish, push } = createContext(
      gitStatus({
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
    );
    await submitGitCommit({
      context,
      cwd: "/repo",
      includeIntent: null,
      message: "ship",
      pushAfterPref: false,
      pushIntent: true,
    });
    expect(publish).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Committed, but couldn't push",
      })
    );
  });
});
