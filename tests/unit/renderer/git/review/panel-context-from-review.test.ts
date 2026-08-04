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
});
