import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import { CanvasCommentOverlay } from "@plugins/builtin/files/renderer/preview/canvas-comment-overlay.tsx";
import type { CanvasCommentPinView } from "@plugins/builtin/files/renderer/preview/canvas-comment-pins.tsx";
import { isCanvasCommentChromePointerEvent } from "@plugins/builtin/files/renderer/preview/canvas-pick-shared.ts";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const mounted: {
  host: HTMLElement;
  shell: HTMLElement;
  unmount: () => void;
}[] = [];

afterEach(() => {
  for (const item of mounted.splice(0)) {
    item.unmount();
    item.host.remove();
    item.shell.remove();
  }
});

function mountOverlay(options: {
  readonly draftOpen?: boolean;
  readonly pickMode?: boolean;
}) {
  const host = document.createElement("div");
  const shell = document.createElement("div");
  document.body.append(host, shell);
  const view = render(
    <CanvasCommentOverlay
      draftOpen={options.draftOpen === true}
      draftPick={
        options.draftOpen === true
          ? { excerpt: "Card body", label: "Card" }
          : null
      }
      draftPlacement={
        options.draftOpen === true
          ? {
              height: 40,
              left: 8,
              originX: 24,
              originY: 16,
              top: 8,
              width: 80,
            }
          : null
      }
      handlers={handlers()}
      host={host}
      labels={LABELS}
      onExitPickMode={vi.fn()}
      onPickElement={vi.fn()}
      pickMode={options.pickMode !== false}
      pins={[PIN]}
      shell={shell}
    />
  );
  const entry = {
    host,
    shell,
    unmount: view.unmount,
  };
  mounted.push(entry);
  return view;
}

describe("isCanvasCommentChromePointerEvent", () => {
  it("recognizes existing pin markers", () => {
    const pin = document.createElement("div");
    pin.setAttribute("data-canvas-comment-pin", "1");
    const event = new Event("pointerdown");
    Object.defineProperty(event, "composedPath", {
      value: () => [pin],
    });
    expect(isCanvasCommentChromePointerEvent(event)).toBe(true);
  });

  it("ignores ordinary canvas content", () => {
    const card = document.createElement("div");
    const event = new Event("pointerdown");
    Object.defineProperty(event, "composedPath", {
      value: () => [card],
    });
    expect(isCanvasCommentChromePointerEvent(event)).toBe(false);
  });
});

describe("CanvasCommentOverlay pick mode", () => {
  it("keeps the pick layer as a crosshair away from pins", () => {
    mountOverlay({ pickMode: true });
    expect(
      document.querySelector("[data-slot='canvas-comment-pick-layer']")
    ).toHaveClass("cursor-crosshair");
  });

  it("keeps existing pins clickable with a pointer cursor", () => {
    mountOverlay({ pickMode: true });
    const badge = screen.getByRole("button", { name: PIN.title });
    expect(badge).toHaveClass("cursor-pointer");
    expect(badge.closest("[data-canvas-comment-pin]")).toHaveClass(
      "cursor-pointer"
    );
  });

  it("previews an existing pin on hover while annotating", async () => {
    mountOverlay({ pickMode: true });
    fireEvent.pointerEnter(screen.getByRole("button", { name: PIN.title }));
    expect(
      await screen.findByText("Fix the padding on this card.")
    ).toBeInTheDocument();
  });

  it("opens edit from an existing pin without swallowing the click", () => {
    mountOverlay({ pickMode: true });
    fireEvent.click(screen.getByRole("button", { name: PIN.title }));
    expect(screen.getByRole("button", { name: LABELS.save })).toBeTruthy();
    expect(screen.getByLabelText(LABELS.title)).toHaveValue(
      "Fix the padding on this card."
    );
  });

  it("freezes pins to static marks while a draft is open", () => {
    mountOverlay({ draftOpen: true, pickMode: true });
    expect(screen.queryByRole("button", { name: PIN.title })).toBeNull();
    expect(
      document.querySelector("[data-slot='comment-count-badge']")
    ).not.toBeNull();
  });
});
