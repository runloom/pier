import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import {
  CanvasCommentPinLayer,
  type CanvasCommentPinView,
} from "@plugins/builtin/files/renderer/preview/canvas-comment-pins.tsx";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const LABELS: PierInlineReviewLabels = {
  authorYou: "You",
  cancel: "Cancel",
  close: "Close",
  deleteComment: "Delete",
  deleted: "Deleted",
  editComment: "Edit",
  inputPlaceholder: "Add comment...",
  save: "Save",
  submit: "Submit",
  title: "Comment",
};

const PIN: CanvasCommentPinView = {
  index: 1,
  key: "pin-1",
  left: 40,
  threads: [
    {
      comment: {
        authorLabel: "You",
        body: "Fix the padding on this card.",
        createdAt: 1,
        id: "c1",
      },
      threadId: "t1",
    },
  ],
  title: "Card",
  top: 20,
};

function handlers(): PierInlineReviewHandlers {
  return {
    onCancelDraft: vi.fn(),
    onDeleteComment: vi.fn().mockResolvedValue(true),
    onEditComment: vi.fn().mockResolvedValue(true),
    onSubmitDraft: vi.fn().mockResolvedValue(true),
  };
}

describe("CanvasCommentPinLayer", () => {
  it("does not park the comment body in the canvas until hover", () => {
    render(
      <CanvasCommentPinLayer
        handlers={handlers()}
        interactive
        labels={LABELS}
        pins={[PIN]}
      />
    );
    expect(
      screen.queryByText("Fix the padding on this card.")
    ).not.toBeInTheDocument();
    expect(
      document.querySelector("[data-slot='comment-hover-preview']")
    ).toBeNull();
  });

  it("previews the comment body on hover in a content-sized card", async () => {
    render(
      <CanvasCommentPinLayer
        handlers={handlers()}
        interactive
        labels={LABELS}
        pins={[PIN]}
      />
    );
    fireEvent.pointerEnter(screen.getByRole("button", { name: PIN.title }));
    expect(
      await screen.findByText("Fix the padding on this card.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: LABELS.save })).toBeNull();
    const preview = document.querySelector(
      "[data-slot='comment-hover-preview']"
    );
    expect(preview).not.toBeNull();
    expect(preview?.closest("[data-slot='hover-card-content']")).toHaveClass(
      "w-fit"
    );
  });

  it("uses a pointer cursor on the live marker", () => {
    render(
      <CanvasCommentPinLayer
        handlers={handlers()}
        interactive
        labels={LABELS}
        pins={[PIN]}
      />
    );
    expect(screen.getByRole("button", { name: PIN.title })).toHaveClass(
      "cursor-pointer"
    );
  });

  it("renders a static mark when not interactive", () => {
    render(
      <CanvasCommentPinLayer
        handlers={handlers()}
        interactive={false}
        labels={LABELS}
        pins={[PIN]}
      />
    );
    expect(screen.queryByRole("button", { name: PIN.title })).toBeNull();
    expect(
      document.querySelector("[data-slot='comment-count-badge']")
    ).not.toBeNull();
  });

  it("opens the shared edit composer on click", () => {
    const onPinOpen = vi.fn();
    render(
      <CanvasCommentPinLayer
        handlers={handlers()}
        interactive
        labels={LABELS}
        onPinOpen={onPinOpen}
        pins={[PIN]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: PIN.title }));
    expect(onPinOpen).toHaveBeenCalledWith(PIN);
    expect(screen.getByRole("button", { name: LABELS.save })).toBeTruthy();
    expect(screen.getByRole("button", { name: LABELS.cancel })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: LABELS.deleteComment })
    ).toBeTruthy();
    expect(screen.getByLabelText(LABELS.title)).toHaveValue(
      "Fix the padding on this card."
    );
    expect(
      document.querySelector("[data-slot='comment-hover-preview']")
    ).toBeNull();
  });

  it("opens a pin requested before it is painted", () => {
    const onConsumed = vi.fn();
    const { rerender } = render(
      <CanvasCommentPinLayer
        handlers={handlers()}
        interactive
        labels={LABELS}
        onRequestOpenConsumed={onConsumed}
        pins={[]}
        requestOpenKey={PIN.key}
      />
    );
    expect(onConsumed).toHaveBeenCalled();
    rerender(
      <CanvasCommentPinLayer
        handlers={handlers()}
        interactive
        labels={LABELS}
        pins={[PIN]}
        requestOpenKey={null}
      />
    );
    expect(screen.getByRole("button", { name: LABELS.save })).toBeTruthy();
  });
});
