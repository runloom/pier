import {
  isGitWorktreeInUseError,
  isGitWorktreeInUseMessage,
  parseGitWorktreeInUse,
  parseGitWorktreeInUseFromError,
} from "@shared/git/worktree-in-use.ts";
import { describe, expect, it } from "vitest";

describe("git/worktree-in-use", () => {
  it("parses modern used-by-worktree wording", () => {
    const message =
      "git 退出码 128: fatal: 'main' is already used by worktree at '/Users/xyz/ABC/pier.worktree/feature-comment-support' -- fatal: 'main' is already used by worktree at '/Users/xyz/ABC/pier.worktree/feature-comment-support'";
    expect(isGitWorktreeInUseMessage(message)).toBe(true);
    expect(parseGitWorktreeInUse(message)).toEqual({
      branch: "main",
      path: "/Users/xyz/ABC/pier.worktree/feature-comment-support",
    });
  });

  it("parses classic already-checked-out wording", () => {
    const message = "fatal: 'bug-fix' is already checked out at '/tmp/another'";
    expect(parseGitWorktreeInUse(message)).toEqual({
      branch: "bug-fix",
      path: "/tmp/another",
    });
  });

  it("parses paths with spaces", () => {
    expect(
      parseGitWorktreeInUse(
        "fatal: 'feat/a' is already used by worktree at '/Users/me/My Projects/repo.worktree/feat-a'"
      )
    ).toEqual({
      branch: "feat/a",
      path: "/Users/me/My Projects/repo.worktree/feat-a",
    });
  });

  it("parses unquoted path after at", () => {
    expect(
      parseGitWorktreeInUse(
        "fatal: 'main' is already used by worktree at /tmp/other-wt"
      )
    ).toEqual({
      branch: "main",
      path: "/tmp/other-wt",
    });
  });

  it("parses bare branch and path (no quotes)", () => {
    expect(
      parseGitWorktreeInUse("fatal: main is already used by worktree at /tmp/x")
    ).toEqual({
      branch: "main",
      path: "/tmp/x",
    });
  });

  it("returns null for unrelated git failures", () => {
    const message =
      "error: Your local changes to the following files would be overwritten by checkout";
    expect(isGitWorktreeInUseMessage(message)).toBe(false);
    expect(parseGitWorktreeInUse(message)).toBeNull();
  });

  it("does not treat gettext-localized worktree-in-use copy as a match", () => {
    // 模拟非英文 msgid：hint 不命中 → 调用方走通用错误（有意 v1 限制）
    const zhStyle = "致命错误：'main' 已由位于 '/tmp/wt' 的工作区使用";
    expect(isGitWorktreeInUseMessage(zhStyle)).toBe(false);
    expect(parseGitWorktreeInUse(zhStyle)).toBeNull();
  });

  it("accepts Error instances", () => {
    const error = new Error(
      "fatal: 'main' is already used by worktree at '/path/to/wt'"
    );
    expect(isGitWorktreeInUseError(error)).toBe(true);
    expect(parseGitWorktreeInUseFromError(error)).toEqual({
      branch: "main",
      path: "/path/to/wt",
    });
  });
});
