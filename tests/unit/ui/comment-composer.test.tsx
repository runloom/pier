import { CommentComposer } from "@pier/ui/comments/composer.tsx";
import type { PierInlineReviewLabels } from "@pier/ui/diff-view/review/inline-comment-types.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const onCancel = vi.fn();
const onDelete = vi.fn();
const onEmptyDismiss = vi.fn();
const onSubmit = vi.fn().mockResolvedValue(true);

beforeEach(() => {
  onCancel.mockClear();
  onDelete.mockClear();
  onEmptyDismiss.mockClear();
  onSubmit.mockClear();
});

function mountCompose(
  initialBody = "",
  options: { emptyDismiss?: boolean } = {}
): {
  outside: HTMLElement;
  textarea: HTMLTextAreaElement;
} {
  const composer =
    options.emptyDismiss === true ? (
      <CommentComposer
        initialBody={initialBody}
        labels={LABELS}
        mode="compose"
        onCancel={onCancel}
        onEmptyDismiss={onEmptyDismiss}
        onSubmit={onSubmit}
      />
    ) : (
      <CommentComposer
        initialBody={initialBody}
        labels={LABELS}
        mode="compose"
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    );
  render(
    <div>
      {composer}
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

describe("CommentComposer compose", () => {
  it("starts compact without edit actions", () => {
    const { textarea } = mountCompose();
    expect(screen.getByRole("button", { name: LABELS.submit })).toBeTruthy();
    expect(screen.queryByRole("button", { name: LABELS.cancel })).toBeNull();
    expect(screen.queryByRole("button", { name: LABELS.save })).toBeNull();
    const root = textarea.closest("[data-slot='comment-composer']");
    expect(root).not.toHaveAttribute("data-expanded");
    expect(root).toHaveClass("w-72");
    expect(root).toHaveClass("focus-within:ring-3");
    expect(textarea).toHaveAttribute("wrap", "off");
  });

  it("cancels an empty draft on outside pointerdown", () => {
    const { outside } = mountCompose();
    fireEvent.pointerDown(outside);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps an unsent draft on outside pointerdown", () => {
    const { outside, textarea } = mountCompose();
    fireEvent.change(textarea, { target: { value: "half written" } });
    fireEvent.pointerDown(outside);
    expect(onCancel).not.toHaveBeenCalled();
    expect(textarea.value).toBe("half written");
  });

  it("does not start a second submit while the first is in flight", async () => {
    let finish: (value: boolean) => void = () => undefined;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    onSubmit.mockReturnValueOnce(pending);
    const { textarea } = mountCompose();
    fireEvent.change(textarea, { target: { value: "note" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    finish(true);
    await pending;
  });

  it("re-enables send after a rejected submit", async () => {
    onSubmit.mockRejectedValueOnce(new Error("nope"));
    const { textarea } = mountCompose();
    fireEvent.change(textarea, { target: { value: "note" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: LABELS.submit })
      ).not.toBeDisabled();
    });
    expect(textarea.value).toBe("note");
  });

  it("submits on Enter and not on Shift+Enter", () => {
    const { textarea } = mountCompose();
    fireEvent.change(textarea, { target: { value: "note" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("note");
  });

  it("expands after a newline", () => {
    const { textarea } = mountCompose();
    fireEvent.change(textarea, { target: { value: "line\n" } });
    expect(textarea.closest("[data-slot='comment-composer']")).toHaveAttribute(
      "data-expanded"
    );
  });

  it("expands on Shift+Enter instead of stretching the compact pill", () => {
    const { textarea } = mountCompose();
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(textarea.closest("[data-slot='comment-composer']")).toHaveAttribute(
      "data-expanded"
    );
  });

  it("expands when a single line no longer fits the pill", () => {
    const { textarea } = mountCompose();
    Object.defineProperty(textarea, "clientWidth", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(textarea, "scrollWidth", {
      configurable: true,
      value: 360,
    });
    fireEvent.change(textarea, {
      target: { value: "同一壳：一个列表，类型是筛选，系统与项目混排。" },
    });
    expect(textarea.closest("[data-slot='comment-composer']")).toHaveAttribute(
      "data-expanded"
    );
  });

  it("cancels on Escape without empty-dismiss", () => {
    const { textarea } = mountCompose("existing body", { emptyDismiss: true });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEmptyDismiss).not.toHaveBeenCalled();
  });

  it("focuses on mount", () => {
    const { textarea } = mountCompose("existing body");
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe("existing body".length);
  });

  it("keeps the focus ring on the full-width plain surface", () => {
    render(
      <CommentComposer
        labels={LABELS}
        mode="compose"
        onCancel={onCancel}
        onSubmit={onSubmit}
        surface="plain"
      />
    );
    const root = screen
      .getByLabelText(LABELS.title)
      .closest("[data-slot='comment-composer']");
    expect(root).toHaveClass("w-full");
    expect(root).toHaveClass("focus-within:ring-3");
    expect(root).toHaveClass("bg-background");
  });
});

describe("CommentComposer edit", () => {
  function mountEdit(): HTMLTextAreaElement {
    render(
      <div>
        <CommentComposer
          initialBody="keep me"
          labels={LABELS}
          mode="edit"
          onCancel={onCancel}
          onDelete={onDelete}
          onSubmit={onSubmit}
        />
        <button data-testid="outside" type="button">
          outside
        </button>
      </div>
    );
    return screen.getByLabelText(LABELS.title) as HTMLTextAreaElement;
  }

  it("opens expanded with delete, cancel, and save", () => {
    mountEdit();
    expect(
      screen
        .getByLabelText(LABELS.title)
        .closest("[data-slot='comment-composer']")
    ).toHaveAttribute("data-expanded");
    expect(
      screen.getByRole("button", { name: LABELS.deleteComment })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: LABELS.cancel })).toBeTruthy();
    expect(screen.getByRole("button", { name: LABELS.save })).toBeTruthy();
    expect(screen.queryByRole("button", { name: LABELS.submit })).toBeNull();
  });

  it("does not dismiss on empty outside pointerdown", () => {
    const textarea = mountEdit();
    fireEvent.change(textarea, { target: { value: "" } });
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("does not submit on Enter; Cmd+Enter saves", () => {
    const textarea = mountEdit();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith("keep me");
  });

  it("saves from the footer button", () => {
    mountEdit();
    fireEvent.click(screen.getByRole("button", { name: LABELS.save }));
    expect(onSubmit).toHaveBeenCalledWith("keep me");
  });

  it("cancels from the footer button", () => {
    mountEdit();
    fireEvent.click(screen.getByRole("button", { name: LABELS.cancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("deletes from the trash button", () => {
    mountEdit();
    fireEvent.click(screen.getByRole("button", { name: LABELS.deleteComment }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
