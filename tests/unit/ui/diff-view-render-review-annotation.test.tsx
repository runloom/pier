import type { PierDriftCommentLabels } from "@pier/ui/diff-view/gutter/gutter-comments.tsx";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import { renderReviewAnnotation } from "@pier/ui/diff-view/review/render-review-annotation.ts";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
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

const HANDLERS: PierInlineReviewHandlers = {
  onCancelDraft: vi.fn(),
  onDeleteComment: vi.fn().mockResolvedValue(true),
  onEditComment: vi.fn().mockResolvedValue(true),
  onSubmitDraft: vi.fn().mockResolvedValue(true),
};

const THREAD: PierInlineReviewThread = {
  comment: { authorLabel: "Alice", body: "hello", createdAt: 1000, id: "c1" },
  threadId: "t1",
};

const DRIFT_LABELS: PierDriftCommentLabels = {
  driftedLineComment: "Comment on line {{line}} can no longer be located",
  driftedLineLabel: "Line {{line}}",
  fileComment: "File comment",
  fileLabel: "File comment",
  sectionHeading: "Code changed",
};

function renderNode(node: ReactNode): void {
  render(<div>{node}</div>);
}

describe("renderReviewAnnotation", () => {
  it("review-thread → 渲染带阴影的展示卡（点击进入编辑）", () => {
    const node = renderReviewAnnotation(
      {
        kind: "review-thread",
        lineNumber: 5,
        side: "additions",
        threadId: "t1",
      },
      {
        handlers: HANDLERS,
        labels: LABELS,
        locale: "en",
        threadById: new Map([["t1", THREAD]]),
      }
    );
    renderNode(node);
    expect(screen.getByText("hello")).toBeInTheDocument();
    const card = screen.getByRole("button", { name: "hello" });
    expect(card).toHaveClass("shadow-sm");
    expect(
      document.querySelector("[data-slot='comment-count-badge']")
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
  });

  it("review-thread → 点击展示卡进入编辑", () => {
    const node = renderReviewAnnotation(
      {
        kind: "review-thread",
        lineNumber: 5,
        side: "additions",
        threadId: "t1",
      },
      {
        handlers: HANDLERS,
        labels: LABELS,
        locale: "en",
        threadById: new Map([["t1", THREAD]]),
      }
    );
    renderNode(node);
    fireEvent.click(screen.getByRole("button", { name: "hello" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(
      document.querySelector("[data-slot='comment-composer']")
    ).toHaveClass("focus-within:ring-3");
  });

  it("review-draft → 渲染草稿卡（提交按钮）", () => {
    const node = renderReviewAnnotation(
      {
        draftId: "d1",
        kind: "review-draft",
        lineNumber: 5,
        side: "additions",
      },
      { handlers: HANDLERS, labels: LABELS, locale: "en" }
    );
    renderNode(node);
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("非 review metadata（hunk-actions）→ undefined（调用方继续 hunk 逻辑）", () => {
    const node = renderReviewAnnotation(
      {
        changeBlockIndex: 0,
        changeKey: "k",
        hunkIndex: 0,
        kind: "hunk-actions",
        path: "a.ts",
        stageState: "unstaged",
      },
      { handlers: HANDLERS, labels: LABELS, locale: "en" }
    );
    expect(node).toBeUndefined();
  });

  it("review-thread 但 threadById 缺该 thread → null", () => {
    const node = renderReviewAnnotation(
      {
        kind: "review-thread",
        lineNumber: 5,
        side: "additions",
        threadId: "missing",
      },
      {
        handlers: HANDLERS,
        labels: LABELS,
        locale: "en",
        threadById: new Map(),
      }
    );
    expect(node).toBeNull();
  });

  it("review-thread 但 handlers/labels/locale/threadById 缺省 → null", () => {
    const node = renderReviewAnnotation(
      {
        kind: "review-thread",
        lineNumber: 5,
        side: "additions",
        threadId: "t1",
      },
      {}
    );
    expect(node).toBeNull();
  });

  it("review-draft 但 handlers/labels/locale 缺省 → null", () => {
    const node = renderReviewAnnotation(
      {
        draftId: "d1",
        kind: "review-draft",
        lineNumber: 5,
        side: "additions",
      },
      {}
    );
    expect(node).toBeNull();
  });

  it("review-drift 行内漂移 → 折叠区标题 + 原行号 summary（无状态徽标）", () => {
    const node = renderReviewAnnotation(
      {
        kind: "review-drift",
        threads: [
          {
            line: 5,
            side: "additions",
            threadId: "t1",
          },
        ],
      },
      {
        driftCommentLabels: DRIFT_LABELS,
        handlers: HANDLERS,
        labels: LABELS,
        locale: "en",
        threadById: new Map([["t1", THREAD]]),
      }
    );
    renderNode(node);
    expect(screen.getByText("Code changed")).toBeInTheDocument();
    expect(screen.getByText("Line 5")).toBeInTheDocument();
    expect(screen.queryByText("Open")).toBeNull();
    expect(screen.queryByText("Resolved")).toBeNull();
  });

  it("review-drift 文件级（无 line）→ fileLabel summary", () => {
    const node = renderReviewAnnotation(
      {
        kind: "review-drift",
        threads: [{ threadId: "t2" }],
      },
      {
        driftCommentLabels: DRIFT_LABELS,
        handlers: HANDLERS,
        labels: LABELS,
        locale: "en",
        threadById: new Map([["t2", THREAD]]),
      }
    );
    renderNode(node);
    expect(screen.getByText("File comment")).toBeInTheDocument();
  });

  it("review-drift 但 driftCommentLabels 缺省 → null", () => {
    const node = renderReviewAnnotation(
      {
        kind: "review-drift",
        threads: [{ threadId: "t1" }],
      },
      {
        handlers: HANDLERS,
        labels: LABELS,
        locale: "en",
        threadById: new Map(),
      }
    );
    expect(node).toBeNull();
  });
});
