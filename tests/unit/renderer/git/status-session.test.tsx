import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  resetGitStatusSessionsForTests,
  useGitStatus,
} from "@plugins/builtin/git/renderer/status-state.ts";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const STATUS = {
  branch: { ahead: 0, behind: 0, branch: "main", upstream: null },
  changeSummary: {
    changedFiles: 0,
    deletions: 0,
    excludedFiles: 0,
    insertions: 0,
    kind: "lineDelta" as const,
  },
  counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
  repoState: { kind: "clean" as const },
  stashCount: 0,
};

function mountHook(context: RendererPluginContext, gitRoot = "/repo"): void {
  function Probe() {
    useGitStatus(context, gitRoot);
    return null;
  }
  render(<Probe />);
}

describe("useGitStatus shared session", () => {
  afterEach(() => {
    cleanup();
    resetGitStatusSessionsForTests();
  });

  it("同 gitRoot 后续 context 刷新 git API，refetch 走最新 getStatus", async () => {
    const firstGetStatus = vi.fn(() => Promise.resolve(STATUS));
    const secondGetStatus = vi.fn(() => Promise.resolve(STATUS));
    let watchListener:
      | ((event: { changeKind: string; gitRoot: string }) => void)
      | undefined;

    const firstContext = {
      git: {
        getStatus: firstGetStatus,
        watch: vi.fn((_root, listener) => {
          watchListener = listener;
          return () => undefined;
        }),
      },
    } as unknown as RendererPluginContext;

    const secondContext = {
      git: {
        getStatus: secondGetStatus,
        watch: vi.fn(() => () => undefined),
      },
    } as unknown as RendererPluginContext;

    mountHook(firstContext);
    await waitFor(() => expect(firstGetStatus).toHaveBeenCalledTimes(1));

    mountHook(secondContext);
    firstGetStatus.mockClear();
    secondGetStatus.mockClear();

    watchListener?.({ changeKind: "worktree", gitRoot: "/repo" });
    await waitFor(() => expect(secondGetStatus).toHaveBeenCalledTimes(1));
    expect(firstGetStatus).not.toHaveBeenCalled();
  });

  it("gitRoot 为空时保持 loading 且不建 session", () => {
    const getStatus = vi.fn(() => Promise.resolve(STATUS));
    const context = {
      git: {
        getStatus,
        watch: vi.fn(() => () => undefined),
      },
    } as unknown as RendererPluginContext;
    const snapshots: Array<{ kind: string }> = [];
    function Probe() {
      snapshots.push(useGitStatus(context, null));
      return null;
    }
    render(<Probe />);
    expect(snapshots[0]).toEqual({ kind: "loading" });
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("已有 loaded session 时后续 hook 首帧即可读到快照", async () => {
    const getStatus = vi.fn(() => Promise.resolve(STATUS));
    const context = {
      git: {
        getStatus,
        watch: vi.fn(() => () => undefined),
      },
    } as unknown as RendererPluginContext;

    const firstKinds: string[] = [];
    function FirstProbe() {
      firstKinds.push(useGitStatus(context, "/repo").kind);
      return null;
    }
    render(<FirstProbe />);
    await waitFor(() => expect(firstKinds.at(-1)).toBe("loaded"));

    const secondSnapshots: Array<{ kind: string }> = [];
    function SecondProbe() {
      secondSnapshots.push(useGitStatus(context, "/repo"));
      return null;
    }
    render(<SecondProbe />);
    expect(secondSnapshots[0]?.kind).toBe("loaded");
  });
});
