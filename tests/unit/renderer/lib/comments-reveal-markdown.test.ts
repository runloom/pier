import type { PanelContext } from "@shared/contracts/panel.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openMarkdownForComment = vi.fn((_input?: unknown) => true);
const openCanvasForComment = vi.fn((_input?: unknown) => true);
const openGitChangesForComments = vi.fn((_input?: unknown) => true);

vi.mock("@/lib/comments/open-markdown.ts", () => ({
  openMarkdownForComment: (input?: unknown) => openMarkdownForComment(input),
}));

vi.mock("@/lib/comments/open-canvas.ts", () => ({
  openCanvasForComment: (input?: unknown) => openCanvasForComment(input),
}));

vi.mock("@/lib/comments/open-git-changes.ts", () => ({
  allocateCommentRevealNonce: () => 1,
  openGitChangesForComments: (input?: unknown) =>
    openGitChangesForComments(input),
}));

import { revealComment } from "@/lib/comments/reveal.ts";

const context = {
  gitRoot: "/repo",
  projectRootPath: "/repo",
  worktreeKey: "/repo",
  worktreeRoot: "/repo",
} as PanelContext;

describe("revealComment", () => {
  beforeEach(() => {
    openMarkdownForComment.mockClear();
    openCanvasForComment.mockClear();
    openGitChangesForComments.mockClear();
  });

  it("opens markdown via openMarkdownForComment", () => {
    const result = revealComment({
      context,
      item: {
        body: "x",
        commentId: "c",
        excerpt: "ex",
        headingId: "api",
        kind: "markdown",
        path: "docs/a.md",
        startLine: 3,
        status: "located",
        threadId: "t",
        updatedAt: 1,
      },
    });
    expect(result).toEqual({ kind: "opened" });
    expect(openMarkdownForComment).toHaveBeenCalledWith(
      expect.objectContaining({
        headingId: "api",
        path: "docs/a.md",
        root: "/repo",
        startLine: 3,
      })
    );
    expect(openGitChangesForComments).not.toHaveBeenCalled();
  });

  it("opens canvas via openCanvasForComment", () => {
    const result = revealComment({
      context,
      item: {
        body: "x",
        commentId: "c",
        kind: "canvas",
        path: ".pier/canvases/x.canvas.tsx",
        status: "located",
        threadId: "t",
        updatedAt: 1,
      },
    });
    expect(result).toEqual({ kind: "opened" });
    expect(openCanvasForComment).toHaveBeenCalledWith(
      expect.objectContaining({
        path: ".pier/canvases/x.canvas.tsx",
        root: "/repo",
      })
    );
    expect(openMarkdownForComment).not.toHaveBeenCalled();
  });

  it("passes canvas anchorId on reveal", () => {
    const result = revealComment({
      context,
      item: {
        anchorId: "login-submit",
        body: "x",
        commentId: "c",
        kind: "canvas",
        path: ".pier/canvases/x.canvas.tsx",
        status: "located",
        threadId: "t",
        updatedAt: 1,
      },
    });
    expect(result).toEqual({ kind: "opened" });
    expect(openCanvasForComment).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorId: "login-submit",
        path: ".pier/canvases/x.canvas.tsx",
      })
    );
  });
});
