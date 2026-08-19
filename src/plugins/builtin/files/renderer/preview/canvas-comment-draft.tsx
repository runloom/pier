/**
 * Canvas pick draft: shared comment composer at the click, in overlay
 * coordinates so it scrolls with the shell (not a portaled popover).
 */
import { CommentComposer } from "@pier/ui/comments/composer.tsx";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import type { CSSProperties, ReactNode } from "react";
import type { CanvasDraftPlacement } from "./use-canvas-preview-comments.ts";
import { CANVAS_PICK_DRAFT_ID } from "./use-canvas-preview-comments.ts";

export function canvasCommentDraftAnchorStyle(
  placement: CanvasDraftPlacement | null
): CSSProperties {
  if (placement === null) {
    return {
      bottom: 16,
      right: 16,
    };
  }
  return {
    left: placement.originX,
    top: placement.originY,
  };
}

export function CanvasCommentDraftCard(props: {
  readonly handlers: PierInlineReviewHandlers;
  readonly labels: PierInlineReviewLabels;
  readonly open: boolean;
  readonly placement: CanvasDraftPlacement | null;
}): ReactNode {
  const { handlers, labels, open, placement } = props;

  if (!open) {
    return null;
  }

  return (
    <div
      className="pointer-events-auto absolute z-30"
      data-slot="canvas-comment-pick-chrome"
      style={canvasCommentDraftAnchorStyle(placement)}
    >
      <CommentComposer
        labels={labels}
        mode="compose"
        onCancel={() => handlers.onCancelDraft(CANVAS_PICK_DRAFT_ID)}
        onSubmit={async (body) =>
          handlers.onSubmitDraft(CANVAS_PICK_DRAFT_ID, body)
        }
      />
    </div>
  );
}
