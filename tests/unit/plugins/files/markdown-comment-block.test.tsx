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
  close: "Close",
  deleteComment: "Delete",
  deleted: "Deleted",
  editComment: "Edit",
  inputPlaceholder: "Write a comment…",
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

function handlers(): PierInlineReviewHandlers {
  return {
    onCancelDraft: vi.fn(),
    onDeleteComment: vi.fn().mockResolvedValue(undefined),
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

  it("opens the existing card in a popover from the gutter badge", () => {
    mountShell({ threads: [THREAD] });
    fireEvent.click(screen.getByLabelText("View comment"));
    expect(
      screen.getByText("Please clarify this heading.")
    ).toBeInTheDocument();
  });

  it("opens the popover when the navigator requests the block", () => {
    mountShell({
      requestOpenBlockKey: "para-1",
      requestOpenNonce: 1,
      threads: [THREAD],
    });
    expect(
      screen.getByText("Please clarify this heading.")
    ).toBeInTheDocument();
  });

  it("shows the thread count on the badge when a block has several comments", () => {
    mountShell({
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
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("keeps the add control when the block has no comments", () => {
    mountShell();
    expect(screen.getByLabelText("Add comment")).toBeInTheDocument();
    expect(screen.queryByLabelText("View comment")).not.toBeInTheDocument();
  });

  it("still mounts the draft editor under the block", () => {
    mountShell({ draftId: "hash-1" });
    expect(screen.getByLabelText("Comment")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add comment")).not.toBeInTheDocument();
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
    expect(
      screen.getByText("Please clarify this heading.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View comment" }));
    expect(
      screen.queryByText("Please clarify this heading.")
    ).not.toBeInTheDocument();
    view.rerender(
      <MarkdownCommentBlockShell
        addCommentLabel="Add comment"
        blockKey="para-1"
        draftId={null}
        handlers={handlers()}
        labels={LABELS}
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
    expect(
      screen.getByText("Please clarify this heading.")
    ).toBeInTheDocument();
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
    expect(
      screen.getByText("Please clarify this heading.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Second block note.")).not.toBeInTheDocument();
    view.rerender(
      <>
        <MarkdownCommentBlockShell
          addCommentLabel="Add comment"
          blockKey="a"
          draftId={null}
          handlers={handlers()}
          labels={LABELS}
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
      screen.queryByText("Please clarify this heading.")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Second block note.")).toBeInTheDocument();
  });

  it("closes located popovers when reveal is a close-all (drift)", () => {
    const view = mountShell({
      requestOpenBlockKey: "para-1",
      requestOpenNonce: 1,
      threads: [THREAD],
    });
    expect(
      screen.getByText("Please clarify this heading.")
    ).toBeInTheDocument();
    view.rerender(
      <MarkdownCommentBlockShell
        addCommentLabel="Add comment"
        blockKey="para-1"
        draftId={null}
        handlers={handlers()}
        labels={LABELS}
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
    expect(
      screen.queryByText("Please clarify this heading.")
    ).not.toBeInTheDocument();
  });

  it("does not move focus to edit when the navigator opens the popover", () => {
    mountShell({
      requestOpenBlockKey: "para-1",
      requestOpenNonce: 1,
      threads: [THREAD],
    });
    expect(screen.getByLabelText("Edit")).not.toHaveFocus();
    expect(screen.getByLabelText("Delete")).not.toHaveFocus();
  });
});
