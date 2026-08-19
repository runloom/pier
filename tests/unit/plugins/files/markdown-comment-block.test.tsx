import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import {
  MarkdownCommentBlockShell,
  markdownCommentViewLabel,
} from "@plugins/builtin/files/renderer/markdown/comments/preview-block.tsx";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

const LABELS: PierInlineReviewLabels = {
  authorYou: "You",
  cancel: "Cancel",
  close: "Close",
  deleteComment: "Delete",
  deleted: "Deleted",
  editComment: "Edit",
  inputPlaceholder: "Write a comment…",
  save: "Save",
  submit: "Submit",
  title: "Comment",
};

const THREAD: PierInlineReviewThread = {
  comment: {
    authorLabel: "You",
    body: "Please clarify this heading.",
    createdAt: 1,
    id: "c1",
  },
  threadId: "t1",
};

function expectComposerOpen(body: string): void {
  expect(screen.getByLabelText("Comment")).toHaveValue(body);
}

function expectComposerClosed(): void {
  expect(screen.queryByLabelText("Comment")).not.toBeInTheDocument();
}

function handlers(): PierInlineReviewHandlers {
  return {
    onCancelDraft: vi.fn(),
    onDeleteComment: vi.fn().mockResolvedValue(true),
    onEditComment: vi.fn().mockResolvedValue(true),
    onSubmitDraft: vi.fn().mockResolvedValue(true),
  };
}

function mountShell(
  overrides: Partial<ComponentProps<typeof MarkdownCommentBlockShell>> = {}
) {
  return render(
    <MarkdownCommentBlockShell
      addCommentLabel="Add comment"
      blockKey="para-1"
      draftId={null}
      handlers={handlers()}
      labels={LABELS}
      markerIndex={0}
      onOpenDraft={vi.fn()}
      threads={[]}
      viewCommentLabel="View comment"
      viewCommentsLabel="View {{count}} comments"
      {...overrides}
    >
      <p>Body paragraph</p>
    </MarkdownCommentBlockShell>
  );
}

describe("markdownCommentViewLabel", () => {
  it("uses the singular label for one comment", () => {
    expect(
      markdownCommentViewLabel({
        count: 1,
        viewComment: "View comment",
        viewComments: "View {{count}} comments",
      })
    ).toBe("View comment");
  });

  it("interpolates the count for multiple comments", () => {
    expect(
      markdownCommentViewLabel({
        count: 3,
        viewComment: "View comment",
        viewComments: "View {{count}} comments",
      })
    ).toBe("View 3 comments");
  });
});

describe("MarkdownCommentBlockShell", () => {
  it("does not park the thread card in the reading column", () => {
    mountShell({ threads: [THREAD] });
    expect(
      screen.queryByText("Please clarify this heading.")
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("View comment")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add comment")).not.toBeInTheDocument();
  });

  it("pins the count badge in the left gutter", () => {
    mountShell({ threads: [THREAD] });
    const badge = screen.getByLabelText("View comment");
    expect(
      badge.closest("[data-slot='markdown-comment-gutter']")
    ).not.toBeNull();
    expect(
      badge.closest("[data-slot='markdown-comment-block']")
    ).not.toBeNull();
  });

  it("previews the comment body on badge hover", async () => {
    mountShell({ threads: [THREAD] });
    fireEvent.pointerEnter(screen.getByLabelText("View comment"));
    expect(
      await screen.findByText("Please clarify this heading.")
    ).toBeInTheDocument();
    expect(
      document.querySelector("[data-slot='comment-hover-preview']")
    ).not.toBeNull();
  });

  it("opens the shared edit composer from the gutter badge", () => {
    mountShell({ threads: [THREAD] });
    fireEvent.click(screen.getByLabelText("View comment"));
    expect(screen.getByLabelText("Comment")).toHaveValue(
      "Please clarify this heading."
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("opens the popover when the navigator requests the block", () => {
    mountShell({
      requestOpenBlockKey: "para-1",
      requestOpenNonce: 1,
      threads: [THREAD],
    });
    expectComposerOpen("Please clarify this heading.");
  });

  it("keeps the aria count when a block has several comments", () => {
    mountShell({
      markerIndex: 1,
      threads: [
        THREAD,
        {
          comment: {
            authorLabel: "You",
            body: "Second note.",
            createdAt: 2,
            id: "c2",
          },
          threadId: "t2",
        },
      ],
    });
    expect(screen.getByLabelText("View 2 comments")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("numbers badges in document order, not per-block thread count", () => {
    render(
      <>
        <MarkdownCommentBlockShell
          addCommentLabel="Add comment"
          blockKey="a"
          draftId={null}
          handlers={handlers()}
          labels={LABELS}
          markerIndex={1}
          onOpenDraft={vi.fn()}
          threads={[THREAD]}
          viewCommentLabel="View comment"
          viewCommentsLabel="View {{count}} comments"
        >
          <p>First</p>
        </MarkdownCommentBlockShell>
        <MarkdownCommentBlockShell
          addCommentLabel="Add comment"
          blockKey="b"
          draftId={null}
          handlers={handlers()}
          labels={LABELS}
          markerIndex={2}
          onOpenDraft={vi.fn()}
          threads={[
            {
              comment: {
                authorLabel: "You",
                body: "Second block note.",
                createdAt: 2,
                id: "c2",
              },
              threadId: "t2",
            },
          ]}
          viewCommentLabel="View comment"
          viewCommentsLabel="View {{count}} comments"
        >
          <p>Second</p>
        </MarkdownCommentBlockShell>
      </>
    );
    const badges = screen.getAllByRole("button", { name: "View comment" });
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent("1");
    expect(badges[1]).toHaveTextContent("2");
  });

  it("keeps the add control when the block has no comments", () => {
    mountShell();
    expect(screen.getByLabelText("Add comment")).toBeInTheDocument();
    expect(screen.queryByLabelText("View comment")).not.toBeInTheDocument();
  });

  it("does not draw a selection box around the markdown block", () => {
    mountShell({ draftId: "hash-1" });
    const block = document.querySelector(
      "[data-slot='markdown-comment-block']"
    );
    const inner = block?.querySelector(":scope > div");
    expect(inner).toBeTruthy();
    expect(inner?.className).not.toContain("ring-");
  });

  it("mounts the pill composer in a collision-aware popover by the gutter icon", () => {
    mountShell({ draftId: "hash-1" });
    expect(screen.getByLabelText("Comment")).toBeInTheDocument();
    const draft = screen
      .getByLabelText("Comment")
      .closest("[data-slot='markdown-comment-draft']");
    expect(draft).not.toBeNull();
    expect(draft?.closest("[data-slot='popover-content']")).not.toBeNull();
    expect(
      screen
        .getByLabelText("Add comment")
        .closest("[data-slot='markdown-comment-gutter']")
    ).not.toBeNull();
  });

  it("shows the count on a single-comment badge", () => {
    mountShell({ threads: [THREAD] });
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("does not open when the navigator nonce is still zero", () => {
    mountShell({
      requestOpenBlockKey: "para-1",
      requestOpenNonce: 0,
      threads: [THREAD],
    });
    expect(
      screen.queryByText("Please clarify this heading.")
    ).not.toBeInTheDocument();
  });

  it("reopens the same block after dismiss when the nonce bumps", () => {
    const view = mountShell({
      requestOpenBlockKey: "para-1",
      requestOpenNonce: 1,
      threads: [THREAD],
    });
    expectComposerOpen("Please clarify this heading.");
    fireEvent.click(screen.getByRole("button", { name: "View comment" }));
    expectComposerClosed();
    view.rerender(
      <MarkdownCommentBlockShell
        addCommentLabel="Add comment"
        blockKey="para-1"
        draftId={null}
        handlers={handlers()}
        labels={LABELS}
        markerIndex={1}
        onOpenDraft={vi.fn()}
        requestOpenBlockKey="para-1"
        requestOpenNonce={2}
        threads={[THREAD]}
        viewCommentLabel="View comment"
        viewCommentsLabel="View {{count}} comments"
      >
        <p>Body paragraph</p>
      </MarkdownCommentBlockShell>
    );
    expectComposerOpen("Please clarify this heading.");
  });

  it("closes a located popover when reveal asks for another block", () => {
    const second: PierInlineReviewThread = {
      comment: {
        authorLabel: "You",
        body: "Second block note.",
        createdAt: 2,
        id: "c2",
      },
      threadId: "t2",
    };
    const view = render(
      <>
        <MarkdownCommentBlockShell
          addCommentLabel="Add comment"
          blockKey="a"
          draftId={null}
          handlers={handlers()}
          labels={LABELS}
          markerIndex={1}
          onOpenDraft={vi.fn()}
          requestOpenBlockKey="a"
          requestOpenNonce={1}
          threads={[THREAD]}
          viewCommentLabel="View comment"
          viewCommentsLabel="View {{count}} comments"
        >
          <p>First</p>
        </MarkdownCommentBlockShell>
        <MarkdownCommentBlockShell
          addCommentLabel="Add comment"
          blockKey="b"
          draftId={null}
          handlers={handlers()}
          labels={LABELS}
          markerIndex={2}
          onOpenDraft={vi.fn()}
          requestOpenBlockKey="a"
          requestOpenNonce={1}
          threads={[second]}
          viewCommentLabel="View comment"
          viewCommentsLabel="View {{count}} comments"
        >
          <p>Second</p>
        </MarkdownCommentBlockShell>
      </>
    );
    expectComposerOpen("Please clarify this heading.");
    expect(
      screen.queryByDisplayValue("Second block note.")
    ).not.toBeInTheDocument();
    view.rerender(
      <>
        <MarkdownCommentBlockShell
          addCommentLabel="Add comment"
          blockKey="a"
          draftId={null}
          handlers={handlers()}
          labels={LABELS}
          markerIndex={1}
          onOpenDraft={vi.fn()}
          requestOpenBlockKey="b"
          requestOpenNonce={2}
          threads={[THREAD]}
          viewCommentLabel="View comment"
          viewCommentsLabel="View {{count}} comments"
        >
          <p>First</p>
        </MarkdownCommentBlockShell>
        <MarkdownCommentBlockShell
          addCommentLabel="Add comment"
          blockKey="b"
          draftId={null}
          handlers={handlers()}
          labels={LABELS}
          markerIndex={2}
          onOpenDraft={vi.fn()}
          requestOpenBlockKey="b"
          requestOpenNonce={2}
          threads={[second]}
          viewCommentLabel="View comment"
          viewCommentsLabel="View {{count}} comments"
        >
          <p>Second</p>
        </MarkdownCommentBlockShell>
      </>
    );
    expect(
      screen.queryByDisplayValue("Please clarify this heading.")
    ).not.toBeInTheDocument();
    expectComposerOpen("Second block note.");
  });

  it("closes located popovers when reveal is a close-all (drift)", () => {
    const view = mountShell({
      requestOpenBlockKey: "para-1",
      requestOpenNonce: 1,
      threads: [THREAD],
    });
    expectComposerOpen("Please clarify this heading.");
    view.rerender(
      <MarkdownCommentBlockShell
        addCommentLabel="Add comment"
        blockKey="para-1"
        draftId={null}
        handlers={handlers()}
        labels={LABELS}
        markerIndex={1}
        onOpenDraft={vi.fn()}
        requestOpenBlockKey={null}
        requestOpenNonce={2}
        threads={[THREAD]}
        viewCommentLabel="View comment"
        viewCommentsLabel="View {{count}} comments"
      >
        <p>Body paragraph</p>
      </MarkdownCommentBlockShell>
    );
    expectComposerClosed();
  });

  it("does not move focus to edit when the navigator opens the popover", () => {
    mountShell({
      requestOpenBlockKey: "para-1",
      requestOpenNonce: 1,
      threads: [THREAD],
    });
    expect(screen.getByLabelText("Comment")).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "Delete" })).not.toHaveFocus();
  });
});
