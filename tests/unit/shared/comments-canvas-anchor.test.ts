import {
  CANVAS_COMMENT_ANCHOR_ATTR,
  canvasCommentAnchorProps,
  collectCanvasCommentAnchorIds,
  findCanvasCommentAnchorElement,
} from "@shared/comments/canvas-anchor.ts";
import { buildCanvasCommentSurface } from "@shared/comments/canvas-surface.ts";
import { describe, expect, it } from "vitest";

describe("canvas comment anchors", () => {
  it("builds data attribute props", () => {
    expect(canvasCommentAnchorProps("login-submit")).toEqual({
      [CANVAS_COMMENT_ANCHOR_ATTR]: "login-submit",
    });
  });

  it("collects unique ids from DOM", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-pier-comment-id="a"></div>
      <span data-pier-comment-id="b"></span>
      <div data-pier-comment-id="a"></div>
      <div data-pier-comment-id="  "></div>
    `;
    expect([...collectCanvasCommentAnchorIds(root)].sort()).toEqual(["a", "b"]);
  });

  it("finds element by id", () => {
    const root = document.createElement("div");
    root.innerHTML = `<button data-pier-comment-id="go">Go</button>`;
    const el = findCanvasCommentAnchorElement(root, "go");
    expect(el?.textContent).toBe("Go");
    expect(findCanvasCommentAnchorElement(root, "missing")).toBeNull();
  });

  it("builds surface", () => {
    const surface = buildCanvasCommentSurface({
      anchorIds: ["x", "y"],
      filePresent: true,
    });
    expect(surface.kind).toBe("canvas");
    expect(surface.filePresent).toBe(true);
    expect(surface.anchorIds.has("x")).toBe(true);
  });
});
