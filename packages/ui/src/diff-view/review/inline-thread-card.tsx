/**
 * 行内评论展示卡（diff 行内已有评论态）。
 *
 * 由 `renderAnnotation` 在 `review-thread` annotation 槽内渲染，也被漂移折叠
 * 区（`drifted-comments.tsx`）复用。锚点仍是批注行（位置不变）。
 *
 * 默认展示是带阴影的产品卡片；点击整卡进入
 * {@link InlineReviewCommentEditor}。删除只在编辑底栏。
 *
 * **宽度约束**：`@pierre/diffs` scroll 模式给 annotation content 设
 * `width: --diffs-column-content-width` + `position: sticky`，故卡片必须
 * `w-full` 贴合该定宽容器。
 */

import { type ReactNode, useCallback, useState } from "react";
import { Button } from "../../button.tsx";
import { cn } from "../../utils.ts";
import { InlineReviewCommentEditor } from "./inline-comment-editor.tsx";
import type {
  PierInlineReviewChrome,
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "./inline-comment-types.ts";

const THREAD_CARD_CLASS =
  "w-full rounded-2xl border border-border bg-background px-3 py-2.5 shadow-sm";

function ThreadBody(props: {
  readonly as?: "p" | "span";
  readonly deletedLabel: string;
  readonly isDeleted: boolean;
  readonly text: string;
}): ReactNode {
  const Tag = props.as ?? "p";
  if (props.isDeleted) {
    return (
      <Tag className="text-muted-foreground italic">{props.deletedLabel}</Tag>
    );
  }
  return (
    <Tag className="whitespace-pre-wrap break-words text-foreground text-sm">
      {props.text}
    </Tag>
  );
}

export function InlineReviewThreadCard({
  chrome = "card",
  handlers,
  initialEditing = false,
  labels,
  thread,
}: {
  /** @see PierInlineReviewChrome */
  readonly chrome?: PierInlineReviewChrome;
  readonly handlers: PierInlineReviewHandlers;
  /** Open directly in edit mode (e.g. Design Mode re-pick of same target). */
  readonly initialEditing?: boolean;
  readonly labels: PierInlineReviewLabels;
  readonly thread: PierInlineReviewThread;
}): ReactNode {
  const [editing, setEditing] = useState(
    () => initialEditing && handlers.onEditComment !== undefined
  );
  const comment = thread.comment;
  const isDeleted = comment.deletedAt !== undefined;
  const onEditComment = handlers.onEditComment;
  const plain = chrome === "plain";
  const canEdit = onEditComment !== undefined && !isDeleted;

  const handleDelete = useCallback(() => {
    handlers.onDeleteComment(thread.threadId, comment.id).catch(console.error);
  }, [comment.id, handlers, thread.threadId]);

  const handleEditSubmit = useCallback(
    async (body: string) => {
      if (!onEditComment) {
        return false;
      }
      const ok = await onEditComment(thread.threadId, comment.id, body);
      if (ok) {
        setEditing(false);
      }
      return ok;
    },
    [comment.id, onEditComment, thread.threadId]
  );

  if (editing && onEditComment) {
    return (
      <div
        className={cn("w-full", plain ? "p-0" : "px-2 py-1.5")}
        data-slot="pier-review-thread"
      >
        <InlineReviewCommentEditor
          initialBody={comment.body}
          labels={labels}
          mode="edit"
          onCancel={() => setEditing(false)}
          onDelete={handleDelete}
          onSubmit={handleEditSubmit}
        />
      </div>
    );
  }

  if (plain) {
    return (
      <div className="w-full p-0" data-slot="pier-review-thread">
        <ThreadBody
          deletedLabel={labels.deleted}
          isDeleted={isDeleted}
          text={comment.body}
        />
      </div>
    );
  }

  return (
    <div className="w-full px-2 py-1.5" data-slot="pier-review-thread">
      {canEdit ? (
        <Button
          className={cn(
            THREAD_CARD_CLASS,
            "h-auto min-h-0 justify-start whitespace-normal text-left font-normal hover:bg-background"
          )}
          onClick={() => setEditing(true)}
          type="button"
          variant="ghost"
        >
          <ThreadBody
            as="span"
            deletedLabel={labels.deleted}
            isDeleted={isDeleted}
            text={comment.body}
          />
        </Button>
      ) : (
        <div className={THREAD_CARD_CLASS}>
          <ThreadBody
            deletedLabel={labels.deleted}
            isDeleted={isDeleted}
            text={comment.body}
          />
        </div>
      )}
    </div>
  );
}
