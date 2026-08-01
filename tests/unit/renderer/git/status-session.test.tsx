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
});
