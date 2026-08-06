/**
 * 行内评论卡（diff 行内展开态，单条批注）。
 *
 * 由 `renderAnnotation` 在 `review-thread` annotation 槽内渲染（light DOM
 * portal，Tailwind class 正常生效）。数据 + 回调 + labels 全经 props 注入，
 * 不耦合 host 评论契约——对齐 hunk-actions 等 diff-view 通用槽边界。
 *
 * v1 瘦身（对标 Codex 单条批注）：只展示一条评论 + 删除，无关闭按钮、
 * 无回复框、无 Resolve/Reopen、无状态徽标。收起靠再点 gutter 标记 /
 * 漂移入口 toggle（host 负责），本卡不提供关闭仪式。
 *
 * 结构走扁平 `div`，去除了原本厚重的 shadcn `Card`，
 * 采用极简的 `border bg-background p-3` 内嵌框。
 * （对齐 GitHub/VS Code/Codex 行内评论：轻边框内嵌而非浮层卡）。
 *
 * **宽度约束（关键）**：`@pierre/diffs` scroll 模式给 annotation content 设
 * `width: --diffs-column-content-width` + `position: sticky`（= 可视代码列宽），
 * 故卡片必须 `w-full` 贴合，否则按内在宽度铺开被父 `overflow-hidden` 裁成
 * "右缘整齐截断"。外层 `px-3 py-2` wrapper 给行内 inset 留白（slot 无 padding）。
 *
 * 写操作经 `handlers` 回调；失败反馈由 host 在回调内处理（带技术详情走
 * alert），卡片不重复反馈。
 */
import { Pencil, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { Button } from "../../button.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "../../input-group.tsx";
import { Textarea } from "../../textarea.tsx";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "./inline-comment-types.ts";

export function InlineReviewThreadCard({
  handlers,
  labels,
  thread,
}: {
  readonly handlers: PierInlineReviewHandlers;
  readonly labels: PierInlineReviewLabels;
  readonly locale: string;
  readonly thread: PierInlineReviewThread;
}): ReactNode {
  const comment = thread.comment;
  const isDeleted = comment.deletedAt !== undefined;
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [submitting, setSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canSubmit =
    editBody.trim().length > 0 && !submitting && editBody !== comment.body;

  const handleDelete = useCallback(async () => {
    await handlers.onDeleteComment(thread.threadId, comment.id);
  }, [comment.id, handlers, thread.threadId]);

  const handleEditSubmit = useCallback(async () => {
    if (!(handlers.onEditComment && canSubmit)) {
      return;
    }
    setSubmitting(true);
    const ok = await handlers.onEditComment(
      thread.threadId,
      comment.id,
      editBody
    );
    setSubmitting(false);
    if (ok) {
      setIsEditing(false);
    }
  }, [canSubmit, comment.id, editBody, handlers, thread.threadId]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditBody(comment.body);
  }, [comment.body]);

  if (isEditing) {
    return (
      <div
        className="w-full px-2 py-1.5"
        data-slot="pier-review-thread-edit"
        ref={containerRef}
      >
        <InputGroup>
          <Textarea
            aria-label={labels.editComment || "Edit"}
            autoFocus
            className="field-sizing-content flex min-h-[4rem] w-full resize-none rounded-md bg-transparent px-3 py-2.5 text-base shadow-none outline-none ring-0 transition-[color,box-shadow] focus-visible:ring-0 aria-invalid:ring-0 md:text-sm dark:bg-transparent"
            onBlur={(e) => {
              if (
                containerRef.current &&
                !containerRef.current.contains(e.relatedTarget as Node)
              ) {
                handleEditCancel();
              }
            }}
            onChange={(event) => setEditBody(event.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleEditSubmit().catch(console.error);
              } else if (e.key === "Escape") {
                handleEditCancel();
              }
            }}
            value={editBody}
          />
          <InputGroupAddon align="block-end">
            <InputGroupButton
              className="ml-auto"
              disabled={!canSubmit}
              onClick={() => {
                handleEditSubmit().catch(console.error);
              }}
              size="sm"
              variant="default"
            >
              {labels.create || "提交"}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    );
  }

  return (
    <div className="w-full px-2 py-1.5" data-slot="pier-review-thread">
      <div className="group flex w-full justify-between gap-4 rounded-md bg-transparent px-3 py-2.5 text-sm transition-colors hover:bg-muted/40">
        <div className="min-w-0 flex-1">
          {isDeleted ? (
            <p className="text-muted-foreground italic">{labels.deleted}</p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-foreground/90">
              {comment.body}
            </p>
          )}
        </div>
        {!isDeleted && (
          <div className="flex shrink-0 items-start gap-1">
            {handlers.onEditComment !== undefined && (
              <Button
                aria-label={labels.editComment || "Edit"}
                className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => setIsEditing(true)}
                size="icon-xs"
                title={labels.editComment || "Edit"}
                tone="muted"
                variant="ghost"
              >
                <Pencil aria-hidden className="size-3.5" />
              </Button>
            )}
            <Button
              aria-label={labels.deleteComment}
              className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={handleDelete}
              size="icon-xs"
              title={labels.deleteComment}
              tone="muted"
              variant="ghost"
            >
              <Trash2 aria-hidden className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
