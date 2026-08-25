/**
 * @vitest-environment jsdom
 */
/**
 * Markdown 评论投影表面总线：发布/清除契约 + 预览 hook 生命周期接线。
 * 保证终端评论对话框拿到 open preview 的 surface（否则 markdown 评论
 * 插入智能体输入框时全部降级为 [unknown]）。
 */

import {
  clearMarkdownCommentSurface,
  getMarkdownCommentSurfaces,
  getMarkdownCommentSurfacesRevision,
  onMarkdownCommentSurfacesChanged,
  setMarkdownCommentSurface,
} from "@plugins/api/markdown-comment-surfaces.ts";
import { useMarkdownPreviewComments } from "@plugins/builtin/files/renderer/markdown/comments/use-preview.ts";
import type { MarkdownIrDocument } from "@plugins/builtin/files/renderer/markdown/ir.ts";
import { buildMarkdownCommentSurface } from "@shared/comments/markdown-surface.ts";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  // Bus is globalThis-attached; isolate every test.
  for (const path of [...getMarkdownCommentSurfaces().keys()]) {
    clearMarkdownCommentSurface(path);
  }
});

const RANGE = {
  endLine: 1,
  endOffset: 10,
  startLine: 1,
  startOffset: 0,
};

function doc(): MarkdownIrDocument {
  return {
    blocks: [
      {
        children: [{ kind: "text", range: RANGE, value: "Title" }],
        depth: 1,
        id: "title",
        kind: "heading",
        range: RANGE,
      },
    ],
    headings: [
      {
        depth: 1,
        id: "title",
        range: RANGE,
        text: "Title",
      },
    ],
    plainText: "Title",
    sourceLength: 5,
    version: 1,
  };
}

const LABELS = {
  addComment: "Add comment",
  authorYou: "You",
  cancel: "Cancel",
  close: "Close",
  createFailed: "failed",
  deleteComment: "Delete",
  deleted: "Deleted",
  deleteFailed: "failed",
  driftTitle: "Drift",
  editComment: "Edit",
  inputPlaceholder: "…",
  save: "Save",
  submit: "Submit",
  title: "Comment",
  updateFailed: "failed",
};

describe("markdown comment surface bus", () => {
  it("normalizes path keys (POSIX slashes, no leading ./)", () => {
    setMarkdownCommentSurface(
      "./docs\\a.md",
      buildMarkdownCommentSurface({
        blockTexts: ["Title"],
        filePresent: true,
        headingIds: ["title"],
      })
    );
    expect([...getMarkdownCommentSurfaces().keys()]).toEqual(["docs/a.md"]);
  });

  it("bumps revision and notifies subscribers on set/clear", () => {
    let notifications = 0;
    const unsubscribe = onMarkdownCommentSurfacesChanged(() => {
      notifications += 1;
    });
    const revisionBefore = getMarkdownCommentSurfacesRevision();
    setMarkdownCommentSurface("a.md", buildSurface());
    expect(getMarkdownCommentSurfacesRevision()).toBe(revisionBefore + 1);
    clearMarkdownCommentSurface("a.md");
    expect(getMarkdownCommentSurfacesRevision()).toBe(revisionBefore + 2);
    expect(notifications).toBe(2);
    unsubscribe();
    // Clearing an absent path is a no-op (no notify).
    clearMarkdownCommentSurface("a.md");
    expect(notifications).toBe(2);
  });
});

function buildSurface() {
  return buildMarkdownCommentSurface({
    blockTexts: ["Title"],
    filePresent: true,
    headingIds: ["title"],
  });
}

describe("useMarkdownPreviewComments surface publishing", () => {
  it("publishes the live surface while the preview is mounted", () => {
    const { unmount } = renderHook(() =>
      useMarkdownPreviewComments({
        context: undefined,
        document: doc(),
        labels: LABELS,
        path: "docs/a.md",
        worktreeKey: undefined,
      })
    );
    const surface = getMarkdownCommentSurfaces().get("docs/a.md");
    expect(surface?.filePresent).toBe(true);
    expect(surface?.headingIds.has("title")).toBe(true);
    unmount();
    expect(getMarkdownCommentSurfaces().has("docs/a.md")).toBe(false);
  });

  it("publishes nothing without a path or parsed document", () => {
    const { unmount: unmountNoPath } = renderHook(() =>
      useMarkdownPreviewComments({
        context: undefined,
        document: doc(),
        labels: LABELS,
        path: undefined,
        worktreeKey: undefined,
      })
    );
    expect(getMarkdownCommentSurfaces().size).toBe(0);
    unmountNoPath();

    const { unmount } = renderHook(() =>
      useMarkdownPreviewComments({
        context: undefined,
        document: undefined,
        labels: LABELS,
        path: "docs/a.md",
        worktreeKey: undefined,
      })
    );
    expect(getMarkdownCommentSurfaces().size).toBe(0);
    unmount();
  });
});
