/**
 * Git / markdown review adapter around {@link CommentComposer}.
 *
 * Uses the `plain` surface (full-width card + focus ring) so the annotation
 * slot stays the same width. Floating overlay chrome is for markdown/canvas
 * drafts and canvas pin edit, which mount {@link CommentComposer} directly.
 */
import type { ReactNode } from "react";
import {
  CommentComposer,
  type CommentComposerMode,
} from "../../comments/composer.tsx";
import type { PierInlineReviewLabels } from "./inline-comment-types.ts";

export function InlineReviewCommentEditor({
  initialBody = "",
  labels,
  mode = "compose",
  onCancel,
  onDelete,
  onEmptyDismiss,
  onSubmit,
}: {
  readonly initialBody?: string;
  readonly labels: PierInlineReviewLabels;
  readonly mode?: CommentComposerMode;
  readonly onCancel: () => void;
  readonly onDelete?: () => void;
  /**
   * Compose only: empty blur / outside pointerdown. Edit ignores empty leave
   * (delete is the trash control; cancel is Escape / 取消).
   */
  readonly onEmptyDismiss?: () => void;
  readonly onSubmit: (body: string) => Promise<boolean>;
}): ReactNode {
  return (
    <CommentComposer
      initialBody={initialBody}
      labels={labels}
      mode={mode}
      onCancel={onCancel}
      {...(onDelete === undefined ? {} : { onDelete })}
      {...(onEmptyDismiss === undefined ? {} : { onEmptyDismiss })}
      onSubmit={onSubmit}
      surface="plain"
    />
  );
}
