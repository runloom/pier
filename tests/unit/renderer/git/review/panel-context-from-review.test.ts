import { panelContextFromReviewGitRoot } from "@plugins/builtin/git/renderer/review/panel-context-from-review.ts";
import { describe, expect, it } from "vitest";

describe("panelContextFromReviewGitRoot", () => {
  it("synthesizes terminal-ready anchors from git root metadata", () => {
    const context = panelContextFromReviewGitRoot({
      contextId: "ctx-1",
      gitRootPath: "/repo",
      now: () => 100,
    });
    expect(context).toEqual({
      contextId: "ctx-1",
      cwd: "/repo",
      gitRoot: "/repo",
      projectRootPath: "/repo",
      source: "panel",
      updatedAt: 100,
      worktreeKey: "/repo",
      worktreeRoot: "/repo",
    });
  });

  it("preserves richer source panel context and fills missing cwd", () => {
    const context = panelContextFromReviewGitRoot({
      contextId: "ctx-1",
      gitRootPath: "/repo",
      now: () => 200,
      sourcePanelContext: {
        branch: "feature",
        contextId: "ctx-1",
        gitRoot: "/repo",
        projectRootPath: "/repo",
        source: "command",
        updatedAt: 1,
        worktreeKey: "/repo",
        worktreeRoot: "/repo",
      },
    });
    expect(context).toMatchObject({
      branch: "feature",
      contextId: "ctx-1",
      cwd: "/repo",
      gitRoot: "/repo",
      projectRootPath: "/repo",
      source: "command",
      updatedAt: 200,
      worktreeRoot: "/repo",
    });
  });

  it("keeps an explicit source cwd when present", () => {
    const context = panelContextFromReviewGitRoot({
      contextId: "ctx-1",
      gitRootPath: "/repo",
      now: () => 300,
      sourcePanelContext: {
        contextId: "ctx-1",
        cwd: "/repo/packages/ui",
        gitRoot: "/repo",
        projectRootPath: "/repo",
        source: "panel",
        updatedAt: 1,
        worktreeRoot: "/repo",
      },
    });
    expect(context.cwd).toBe("/repo/packages/ui");
    expect(context.projectRootPath).toBe("/repo");
  });

  it("rejects a foreign source panel and synthesizes from git root only", () => {
    const context = panelContextFromReviewGitRoot({
      contextId: "ctx-review",
      gitRootPath: "/repo-a",
      now: () => 400,
      sourcePanelContext: {
        branch: "other",
        contextId: "ctx-other",
        cwd: "/repo-b/packages",
        gitRoot: "/repo-b",
        projectRootPath: "/repo-b",
        source: "panel",
        updatedAt: 1,
        worktreeKey: "/repo-b",
        worktreeRoot: "/repo-b",
      },
    });
    expect(context).toEqual({
      contextId: "ctx-review",
      cwd: "/repo-a",
      gitRoot: "/repo-a",
      projectRootPath: "/repo-a",
      source: "panel",
      updatedAt: 400,
      worktreeKey: "/repo-a",
      worktreeRoot: "/repo-a",
    });
    expect(context).not.toMatchObject({
      branch: "other",
      cwd: "/repo-b/packages",
    });
  });

  it("merges when contextId matches even if git roots differ only by alias fields", () => {
    const context = panelContextFromReviewGitRoot({
      contextId: "ctx-1",
      gitRootPath: "/repo",
      now: () => 500,
      sourcePanelContext: {
        contextId: "ctx-1",
        cwd: "/repo/sub",
        gitRoot: "/repo",
        projectRootPath: "/repo",
        source: "panel",
        updatedAt: 1,
        worktreeRoot: "/repo",
      },
    });
    expect(context.contextId).toBe("ctx-1");
    expect(context.cwd).toBe("/repo/sub");
  });

  it("merges when a root field matches even if contextId differs", () => {
    const context = panelContextFromReviewGitRoot({
      contextId: "ctx-review",
      gitRootPath: "/repo",
      now: () => 600,
      sourcePanelContext: {
        branch: "feature",
        contextId: "ctx-stale-id",
        cwd: "/repo/apps",
        gitRoot: "/repo",
        projectRootPath: "/repo",
        source: "panel",
        updatedAt: 1,
        worktreeRoot: "/repo",
      },
    });
    expect(context).toMatchObject({
      branch: "feature",
      contextId: "ctx-stale-id",
      cwd: "/repo/apps",
      gitRoot: "/repo",
    });
  });
});
