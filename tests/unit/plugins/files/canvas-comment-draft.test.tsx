import { canvasCommentDraftAnchorStyle } from "@plugins/builtin/files/renderer/preview/canvas-comment-draft.tsx";
import { describe, expect, it } from "vitest";

describe("canvasCommentDraftAnchorStyle", () => {
  it("pins the popover anchor to the click, not the selection center", () => {
    expect(
      canvasCommentDraftAnchorStyle({
        height: 400,
        left: 10,
        originX: 80,
        originY: 120,
        top: 20,
        width: 600,
      })
    ).toEqual({ left: 80, top: 120 });
  });
});
