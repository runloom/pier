import { describe, expect, it } from "vitest";
import { filesLspWorkspaceIdentity } from "../../../../../src/plugins/builtin/files/renderer/lsp/workspace.ts";

const baseContext = {
  contextId: "repo",
  gitCommonDir: "/repo/.git",
  gitRoot: "/repo",
  projectRootPath: "/repo",
  updatedAt: 1,
  worktreeKey: "/repo",
  worktreeRoot: "/repo",
};

describe("filesLspWorkspaceIdentity", () => {
  it("keeps a normal repository in the main workspace pool", () => {
    expect(
      filesLspWorkspaceIdentity(
        { ...baseContext, gitDir: "/repo/.git" },
        "/repo"
      )
    ).toEqual({ isWorktree: false, workspaceKey: "main:/repo" });
  });

  it("marks a linked worktree from Git common-dir metadata", () => {
    expect(
      filesLspWorkspaceIdentity(
        {
          ...baseContext,
          gitDir: "/repo/.git/worktrees/feature",
          gitRoot: "/repo.worktree/feature",
          projectRootPath: "/repo.worktree/feature",
          worktreeKey: "/repo.worktree/feature",
          worktreeRoot: "/repo.worktree/feature",
        },
        "/repo.worktree/feature"
      )
    ).toEqual({
      isWorktree: true,
      workspaceKey: "wt:/repo.worktree/feature",
    });
  });

  it("treats missing gitDir conservatively when worktree roots differ", () => {
    expect(
      filesLspWorkspaceIdentity(
        {
          ...baseContext,
          gitDir: undefined,
          gitRoot: "/repo",
          projectRootPath: "/repo.worktree/feature",
          worktreeKey: "/repo.worktree/feature",
          worktreeRoot: "/repo.worktree/feature",
        },
        "/repo.worktree/feature"
      )
    ).toEqual({
      isWorktree: true,
      workspaceKey: "wt:/repo.worktree/feature",
    });
  });

  it("treats gitDir under .git/worktrees as linked even without commonDir compare", () => {
    expect(
      filesLspWorkspaceIdentity(
        {
          ...baseContext,
          gitCommonDir: undefined,
          gitDir: "/repo/.git/worktrees/feature",
          gitRoot: "/repo.worktree/feature",
          projectRootPath: "/repo.worktree/feature",
          worktreeKey: "/repo.worktree/feature",
          worktreeRoot: "/repo.worktree/feature",
        },
        "/repo.worktree/feature"
      )
    ).toEqual({
      isWorktree: true,
      workspaceKey: "wt:/repo.worktree/feature",
    });
  });
});
