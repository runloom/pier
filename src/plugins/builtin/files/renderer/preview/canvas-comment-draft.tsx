/**
 * Canvas pick draft: shadcn Popover anchored at the selection (no hand-rolled panel coords).
 */
import { InlineReviewCommentEditor } from "@pier/ui/diff-view/review/inline-comment-editor.tsx";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import { Popover, PopoverAnchor, PopoverContent } from "@pier/ui/popover.tsx";
import type { ReactNode } from "react";
import type { CanvasDraftPlacement } from "./use-canvas-preview-comments.ts";
import { CANVAS_PICK_DRAFT_ID } from "./use-canvas-preview-comments.ts";

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

  // Anchor at bottom-left of the selection box; Popover handles flip/collision.
  const anchorStyle =
    placement === null
      ? ({ right: 16, bottom: 16, width: 1, height: 1 } as const)
      : ({
          left: placement.left,
          top: placement.top + placement.height,
          width: Math.max(1, placement.width),
          height: 1,
        } as const);

  return (
    <Popover
      onOpenChange={(next) => {
        if (!next) {
          handlers.onCancelDraft(CANVAS_PICK_DRAFT_ID);
        }
      }}
      open={open}
    >
      <PopoverAnchor asChild>
        <div
          aria-hidden
          className="pointer-events-none absolute z-30"
          data-slot="canvas-comment-pick-chrome"
          style={anchorStyle}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-80 gap-2 p-3"
        collisionPadding={12}
        onOpenAutoFocus={(event) => {
          // Let the textarea focus itself (editor mounts with focus).
          event.preventDefault();
        }}
        side="bottom"
        sideOffset={8}
      >
        <InlineReviewCommentEditor
          chrome="plain"
          labels={labels}
          onCancel={() => handlers.onCancelDraft(CANVAS_PICK_DRAFT_ID)}
          onSubmit={async (body) =>
            handlers.onSubmitDraft(CANVAS_PICK_DRAFT_ID, body)
          }
        />
      </PopoverContent>
    </Popover>
  );
}
