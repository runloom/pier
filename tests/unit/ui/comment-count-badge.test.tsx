import {
  CommentCountBadge,
  CommentCountBadgeStatic,
} from "@pier/ui/comments/count-badge.tsx";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("CommentCountBadge", () => {
  it("paints the MessageCircle marker with the identifier", () => {
    const { container } = render(
      <CommentCountBadge aria-label="View comment" count={1} />
    );
    expect(screen.getByLabelText("View comment")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByLabelText("View comment")).toHaveClass("cursor-pointer");
    expect(container.querySelector("svg.lucide-message-circle")).not.toBeNull();
  });

  it("keeps two-digit identifiers inside the same marker", () => {
    render(<CommentCountBadgeStatic count={33} />);
    expect(screen.getByText("33")).toBeInTheDocument();
  });

  it("centers the identifier with grid, not pixel translates", () => {
    render(<CommentCountBadgeStatic count={1} />);
    const label = screen.getByText("1");
    expect(label.className).toContain("col-start-1");
    expect(label.className).toContain("row-start-1");
    expect(label.className).not.toMatch(/translate-[xy]/u);
    expect(label.parentElement?.className).toContain("place-items-center");
  });
});
