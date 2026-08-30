import { resolveGitWorktreeFamily } from "@main/services/git/worktree/main-path.ts";
import { describe, expect, it, vi } from "vitest";

describe("resolveGitWorktreeFamily", () => {
  it("returns null when show-toplevel fails", async () => {
    const result = await resolveGitWorktreeFamily("/not-git", {
      execGit: async () => {
        throw new Error("not a git repository");
      },
      realpath: async (path) => path,
    });
    expect(result).toBeNull();
  });

  it("returns the porcelain first entry as main and the rest as linked", async () => {
    const execGit = vi.fn(async (args: readonly string[]) => {
      if (args.includes("--show-toplevel")) {
        return "/repo.worktree/feat\n";
      }
      return [
        "worktree /repo",
        "HEAD abc",
        "branch refs/heads/main",
        "",
        "worktree /repo.worktree/feat",
        "HEAD def",
        "branch refs/heads/feat",
        "",
      ].join("\0");
    });

    const result = await resolveGitWorktreeFamily("/repo.worktree/feat", {
      execGit,
      realpath: async (path) => path,
    });
    expect(result).toEqual({
      linkedPaths: ["/repo.worktree/feat"],
      mainPath: "/repo",
    });
  });

  it("falls back to toplevel when worktree list fails", async () => {
    const result = await resolveGitWorktreeFamily("/repo", {
      execGit: async (args) => {
        if (args.includes("--show-toplevel")) {
          return "/repo\n";
        }
        throw new Error("worktree list failed");
      },
      realpath: async (path) => path,
    });
    expect(result).toEqual({ linkedPaths: [], mainPath: "/repo" });
  });
});
