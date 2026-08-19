import {
  COMMENT_FLOATER_POSITION,
  COMMENT_HOVER_CARD_CLASS,
  CommentHoverPreview,
} from "@pier/ui/comments/hover-preview.tsx";
import { TOOLTIP_COLLISION_PADDING } from "@pier/ui/tooltip.tsx";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("CommentHoverPreview", () => {
  it("hugs a short note instead of stretching to a fixed width", () => {
    const { container } = render(
      <CommentHoverPreview items={[{ body: "333", id: "c1" }]} />
    );
    expect(screen.getByText("333")).toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute(
      "data-slot",
      "comment-hover-preview"
    );
    expect(COMMENT_HOVER_CARD_CLASS).toContain("w-fit");
    expect(COMMENT_HOVER_CARD_CLASS).toContain("max-w-72");
  });

  it("reuses tooltip collision padding so floaters flip instead of leaving the frame", () => {
    expect(COMMENT_FLOATER_POSITION.side).toBe("right");
    expect(COMMENT_FLOATER_POSITION.avoidCollisions).toBe(true);
    expect(COMMENT_FLOATER_POSITION.collisionPadding).toEqual(
      TOOLTIP_COLLISION_PADDING
    );
    expect(COMMENT_FLOATER_POSITION).not.toHaveProperty("sticky");
  });
});
