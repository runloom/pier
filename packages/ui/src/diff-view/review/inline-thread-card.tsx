/**
 * 行内评论展示卡（diff 行内已有评论态）。
 *
 * 由 `renderAnnotation` 在 `review-thread` annotation 槽内渲染，也被漂移折叠
 * 区（`drifted-comments.tsx`）复用。
 *
 * v1 极简结构：无标题栏、无头像、无作者名、无时间戳——只有正文一段，
 * hover 才浮出「编辑 / 删除」两个图标按钮：命中区走 `size="icon"`（28×28
 * 标准纯图标档），glyph 在 SVG 上标 `size-3.5`（14px）——Button 的
 * `[&_svg:not([class*='size-'])]` 只给未声明尺寸的图标兜底，显式 size 是
 * 规范允许的「同 hit、略小笔形」路径（对齐 hunk-actions / stage-button）。
 *
 * **两态一律不铺填充色**：批注行
 * 底色由 diff 引擎画（选中行还会叠选中蓝），卡片自带任何 surface 都会盖掉
 * 它、和周围割裂。只留 1px 边框划出边界，背景恒等于所在批注行。
 *
 * 注意批注行本身默认也不是普通行底色——pierre 把它当上下文块刷成
 * `--diffs-bg-context`。压平那层灰是 `CODE_VIEW_CUSTOM_CSS` 的
 * `--diffs-annotation-bg` 覆写，不要试图在卡片这一侧补偿。
 *
 * 编辑态复用与草稿卡同壳的 {@link InlineReviewCommentEditor}：
 * 单一「提交」；Escape = 放弃编辑回到展示态；**清空正文后失焦 / 外点 =
 * 删除该评论**（与「空内容不该留下」一致，不是静默还原旧文）。
 * `onEditComment` 未注入时不渲染编辑按钮。
 *
 * **宽度约束（关键）**：`@pierre/diffs` scroll 模式给 annotation content 设
 * `width: --diffs-column-content-width` + `position: sticky`，故卡片必须
 * `w-full` 贴合该定宽容器，否则被父 `overflow-hidden` 裁成右缘截断。
 */
import { Pencil, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { Button } from "../../button.tsx";
import { InlineReviewCommentEditor } from "./inline-comment-editor.tsx";
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
  readonly thread: PierInlineReviewThread;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const comment = thread.comment;
  const isDeleted = comment.deletedAt !== undefined;
  const onEditComment = handlers.onEditComment;

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

  const handleEmptyDismiss = useCallback(() => {
    // 编辑态把正文清空再离开 = 用户明确不要这条评论。
    handlers.onDeleteComment(thread.threadId, comment.id).catch(console.error);
    setEditing(false);
  }, [comment.id, handlers, thread.threadId]);

  if (editing && onEditComment) {
    return (
      <div className="w-full px-2 py-1.5" data-slot="pier-review-thread">
        <InlineReviewCommentEditor
          initialBody={comment.body}
          labels={labels}
          onCancel={() => setEditing(false)}
          onEmptyDismiss={handleEmptyDismiss}
          onSubmit={handleEditSubmit}
        />
      </div>
    );
  }

  return (
    <div className="w-full px-2 py-1.5" data-slot="pier-review-thread">
      <div className="group flex w-full justify-between gap-4 rounded-2xl border border-border bg-transparent px-3 py-2.5 text-sm">
        <div className="min-w-0 flex-1">
          {isDeleted ? (
            <p className="text-muted-foreground italic">{labels.deleted}</p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-foreground/90">
              {comment.body}
            </p>
          )}
        </div>
        {isDeleted ? null : (
          <div className="-mt-1 flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {onEditComment ? (
              <Button
                aria-label={labels.editComment}
                onClick={() => setEditing(true)}
                size="icon"
                title={labels.editComment}
                tone="muted"
                variant="ghost"
              >
                <Pencil aria-hidden className="size-3.5" data-icon />
              </Button>
            ) : null}
            <Button
              aria-label={labels.deleteComment}
              onClick={handleDelete}
              size="icon"
              title={labels.deleteComment}
              tone="muted"
              variant="ghost"
            >
              <Trash2 aria-hidden className="size-3.5" data-icon />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
