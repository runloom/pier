/**
 * 行内评论草稿卡（diff 行内新建评论态）。
 *
 * 由 `renderAnnotation` 在 `review-draft` annotation 槽内渲染。用户点 gutter
 * `+` 入口后激活，直接呈现 {@link InlineReviewCommentEditor}：无标题栏、无
 * 头像、无取消按钮——提交成功转真实 thread（host 移除草稿槽 + 注入 thread
 * 槽）。失焦时空草稿自动收起、已写内容原样保留；`Escape` 一律取消。
 *
 * **宽度约束（关键）**：`@pierre/diffs` scroll 模式给 annotation content 设
 * `width: --diffs-column-content-width` + `position: sticky`（= 可视代码列宽），
 * 故卡片必须 `w-full` 贴合该定宽容器，否则按内在宽度铺开被父 `overflow-hidden`
 * 裁成"右缘整齐截断"。外层 wrapper 只给行内 inset 留白（slot 自身无 padding）。
 *
 * 数据 + 回调 + labels 经 props 注入，不耦合 host 契约。`onSubmitDraft`
 * 返回 boolean（成功才清空输入框；host 据此移除草稿槽转 thread 槽）。
 * 失败反馈由 host 在回调内处理，卡片不重复反馈。
 */
import type { ReactNode } from "react";
import { InlineReviewCommentEditor } from "./inline-comment-editor.tsx";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
} from "./inline-comment-types.ts";

export function InlineReviewDraftCard({
  draftId,
  handlers,
  labels,
}: {
  readonly draftId: string;
  readonly handlers: PierInlineReviewHandlers;
  readonly labels: PierInlineReviewLabels;
}): ReactNode {
  return (
    <div className="w-full px-2 py-1.5" data-slot="pier-review-draft">
      <InlineReviewCommentEditor
        labels={labels}
        onCancel={() => handlers.onCancelDraft(draftId)}
        onSubmit={(body) => handlers.onSubmitDraft(draftId, body)}
      />
    </div>
  );
}
