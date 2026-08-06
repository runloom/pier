/**
 * 行内评论草稿卡（diff 行内新建线程态）。
 *
 * 由 `renderAnnotation` 在 `review-draft` annotation 槽内渲染。用户点
 * gutter `+` 入口后激活：显示输入框 + 创建按钮；提交成功转真实 thread
 * （host 移除草稿槽 + 注入 thread 槽），取消则移除草稿槽。
 *
 * 结构走扁平 `div`，去除了原本的 shadcn `Card` 结构，
 * 采用极简的 `border bg-background p-3` 内嵌框。草稿卡无
 * 评论列表，Textarea + 底部操作栏直接堆叠。
 * （对齐 GitHub/VS Code 行内 compose box：轻边框内嵌而非浮层卡）。
 *
 * **宽度约束（关键）**：`@pierre/diffs` scroll 模式给 annotation content 设
 * `width: --diffs-column-content-width` + `position: sticky`（= 可视代码列宽），
 * 故卡片必须 `w-full` 贴合该定宽容器，否则按内在宽度铺开被父 `overflow-hidden`
 * 裁成"右缘整齐截断"。外层 `px-3 py-2` wrapper 给行内 inset 留白（slot 自身
 * 无 padding），Textarea 覆写 `min-h-[4.5rem] rounded-md` 收敛默认对话尺寸。
 *
 * 数据 + 回调 + labels 经 props 注入，不耦合 host 契约。`onSubmitDraft`
 * 返回 boolean（成功才清空输入框；host 据此移除草稿槽转 thread 槽）。
 * 失败反馈由 host 在回调内处理，卡片不重复反馈。
 */
import { type ReactNode, useCallback, useRef, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "../../input-group.tsx";
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
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = body.trim().length > 0 && !submitting;
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(async () => {
    if (body.trim().length === 0 || submitting) {
      return;
    }
    setSubmitting(true);
    const ok = await handlers.onSubmitDraft(draftId, body);
    setSubmitting(false);
    if (ok) {
      setBody("");
    }
  }, [body, draftId, handlers, submitting]);

  const handleCancel = useCallback(() => {
    handlers.onCancelDraft(draftId);
  }, [draftId, handlers]);

  return (
    <div
      className="w-full px-2 py-1.5"
      data-slot="pier-review-draft"
      ref={containerRef}
    >
      <InputGroup>
        <InputGroupTextarea
          aria-label={labels.title}
          autoFocus
          className="field-sizing-content min-h-16 px-3 py-2.5"
          onBlur={(e) => {
            if (
              containerRef.current &&
              !containerRef.current.contains(e.relatedTarget as Node)
            ) {
              handleCancel();
            }
          }}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleSubmit().catch(console.error);
            } else if (e.key === "Escape") {
              handleCancel();
            }
          }}
          placeholder={labels.inputPlaceholder}
          value={body}
        />
        <InputGroupAddon align="block-end">
          <InputGroupButton
            className="ml-auto"
            disabled={!canSubmit}
            onClick={() => {
              handleSubmit().catch(console.error);
            }}
            size="sm"
            variant="default"
          >
            {labels.create}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
