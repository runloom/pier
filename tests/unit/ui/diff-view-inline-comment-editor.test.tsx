import { InlineReviewCommentEditor } from "@pier/ui/diff-view/review/inline-comment-editor.tsx";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import { InlineReviewThreadCard } from "@pier/ui/diff-view/review/inline-thread-card.tsx";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const onCancel = vi.fn();
const onEmptyDismiss = vi.fn();
const onSubmit = vi.fn().mockResolvedValue(true);

beforeEach(() => {
  onCancel.mockClear();
  onEmptyDismiss.mockClear();
  onSubmit.mockClear();
});

/** 草稿态 = 空 initialBody（与省略该 prop 等价，组件默认值即 ""）。 */
function mount(
  initialBody = "",
  options: { emptyDismiss?: boolean } = {}
): {
  outside: HTMLElement;
  textarea: HTMLTextAreaElement;
} {
  const editor =
    options.emptyDismiss === true ? (
      <InlineReviewCommentEditor
        initialBody={initialBody}
        labels={LABELS}
        onCancel={onCancel}
        onEmptyDismiss={onEmptyDismiss}
        onSubmit={onSubmit}
      />
    ) : (
      <InlineReviewCommentEditor
        initialBody={initialBody}
        labels={LABELS}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    );
  render(
    <div>
      {editor}
      <button data-testid="outside" type="button">
        outside
      </button>
    </div>
  );
  return {
    outside: screen.getByTestId("outside"),
    textarea: screen.getByLabelText(LABELS.title) as HTMLTextAreaElement,
  };
}

/**
 * 失焦 / 外点语义：空壳收起、有内容保留。
 *
 * 编辑器没有取消按钮，收起靠 blur + capture pointerdown。diff 代码行不可聚焦
 * 时 blur 不会触发，所以外点检测是空草稿能收起的主路径。编辑态清空后离开走
 * `onEmptyDismiss`（删评论），与 Escape 的 `onCancel`（放弃编辑）分离。
 */
describe("InlineReviewCommentEditor blur and outside dismiss", () => {
  it("cancels an empty draft when focus leaves", () => {
    const { outside, textarea } = mount();
    fireEvent.blur(textarea, { relatedTarget: outside });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels an empty draft on outside pointerdown", () => {
    const { outside } = mount();
    fireEvent.pointerDown(outside);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("treats whitespace-only input as empty on outside pointerdown", () => {
    const { outside, textarea } = mount();
    fireEvent.change(textarea, { target: { value: "   \n  " } });
    fireEvent.pointerDown(outside);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps an unsent draft when focus leaves", () => {
    const { outside, textarea } = mount();
    fireEvent.change(textarea, { target: { value: "half written" } });
    fireEvent.blur(textarea, { relatedTarget: outside });
    expect(onCancel).not.toHaveBeenCalled();
    expect(textarea.value).toBe("half written");
  });

  it("keeps an unsent draft on outside pointerdown", () => {
    const { outside, textarea } = mount();
    fireEvent.change(textarea, { target: { value: "half written" } });
    fireEvent.pointerDown(outside);
    expect(onCancel).not.toHaveBeenCalled();
    expect(textarea.value).toBe("half written");
  });

  it("keeps edited text when focus leaves", () => {
    const { outside, textarea } = mount("existing body");
    fireEvent.change(textarea, { target: { value: "existing body edited" } });
    fireEvent.blur(textarea, { relatedTarget: outside });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onEmptyDismiss).not.toHaveBeenCalled();
    expect(textarea.value).toBe("existing body edited");
  });

  it("routes cleared body dismiss to onEmptyDismiss when provided", () => {
    const { outside, textarea } = mount("existing body", {
      emptyDismiss: true,
    });
    fireEvent.change(textarea, { target: { value: "" } });
    fireEvent.blur(textarea, { relatedTarget: outside });
    expect(onEmptyDismiss).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("falls back to onCancel for empty dismiss when onEmptyDismiss is omitted", () => {
    const { outside, textarea } = mount("existing body");
    fireEvent.change(textarea, { target: { value: "" } });
    fireEvent.blur(textarea, { relatedTarget: outside });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores focus moves inside the editor", () => {
    const { textarea } = mount();
    fireEvent.blur(textarea, {
      relatedTarget: screen.getByRole("button", { name: LABELS.submit }),
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("ignores pointerdown inside the editor", () => {
    const { textarea } = mount();
    fireEvent.pointerDown(screen.getByRole("button", { name: LABELS.submit }));
    fireEvent.pointerDown(textarea);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape even with content without empty-dismiss", () => {
    const { textarea } = mount("existing body", { emptyDismiss: true });
    fireEvent.change(textarea, { target: { value: "" } });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEmptyDismiss).not.toHaveBeenCalled();
  });

  it("focuses and places the caret at the end on mount", () => {
    const { textarea } = mount("existing body");
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe("existing body".length);
    expect(textarea.selectionEnd).toBe("existing body".length);
  });
});

describe("InlineReviewThreadCard empty edit dismiss", () => {
  it("deletes the comment when edit body is cleared and focus leaves", async () => {
    const onDeleteComment = vi.fn().mockResolvedValue(undefined);
    const handlers: PierInlineReviewHandlers = {
      onCancelDraft: vi.fn(),
      onDeleteComment,
      onEditComment: vi.fn().mockResolvedValue(true),
      onSubmitDraft: vi.fn().mockResolvedValue(true),
    };
    const thread: PierInlineReviewThread = {
      comment: {
        authorLabel: "Alice",
        body: "keep me",
        createdAt: 1,
        id: "c1",
      },
      threadId: "t1",
    };

    render(
      <div>
        <InlineReviewThreadCard
          handlers={handlers}
          labels={LABELS}
          thread={thread}
        />
        <button data-testid="outside" type="button">
          outside
        </button>
      </div>
    );

    fireEvent.click(screen.getByRole("button", { name: LABELS.editComment }));
    const textarea = screen.getByLabelText(LABELS.title) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "" } });
    fireEvent.blur(textarea, {
      relatedTarget: screen.getByTestId("outside"),
    });

    expect(onDeleteComment).toHaveBeenCalledWith("t1", "c1");
  });

  it("does not delete when Escape aborts an emptied edit", () => {
    const onDeleteComment = vi.fn().mockResolvedValue(undefined);
    const handlers: PierInlineReviewHandlers = {
      onCancelDraft: vi.fn(),
      onDeleteComment,
      onEditComment: vi.fn().mockResolvedValue(true),
      onSubmitDraft: vi.fn().mockResolvedValue(true),
    };
    const thread: PierInlineReviewThread = {
      comment: {
        authorLabel: "Alice",
        body: "keep me",
        createdAt: 1,
        id: "c1",
      },
      threadId: "t1",
    };

    render(
      <InlineReviewThreadCard
        handlers={handlers}
        labels={LABELS}
        thread={thread}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: LABELS.editComment }));
    const textarea = screen.getByLabelText(LABELS.title);
    fireEvent.change(textarea, { target: { value: "" } });
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(onDeleteComment).not.toHaveBeenCalled();
    expect(screen.getByText("keep me")).toBeTruthy();
  });
});
