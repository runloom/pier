import { CommentNavigator } from "@pier/ui/comments/navigator.tsx";
import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("CommentNavigator", () => {
  it("keeps next, previous, and the position control enabled for a single comment", () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const onRevealCurrent = vi.fn();
    render(
      <TooltipProvider>
        <CommentNavigator
          activeIndex={0}
          clearLabel="Clear all"
          nextLabel="Next comment"
          onClear={vi.fn()}
          onNext={onNext}
          onPrevious={onPrevious}
          onRevealCurrent={onRevealCurrent}
          positionLabel="Comment 1 of 1"
          previousLabel="Previous comment"
          toolbarLabel="Comments"
          total={1}
        />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByLabelText("Next comment"));
    fireEvent.click(screen.getByLabelText("Previous comment"));
    fireEvent.click(screen.getByLabelText("Comment 1 of 1"));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onRevealCurrent).toHaveBeenCalledTimes(1);
  });
});
