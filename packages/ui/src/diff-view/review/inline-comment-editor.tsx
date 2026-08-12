/**
 * 行内评论编辑器（草稿态与编辑态共用的唯一输入实现）。
 *
 * 严格对齐 shadcn `InputGroup` 自动增高 textarea 范式：
 * `InputGroup` > `InputGroupTextarea` + `InputGroupAddon align="block-end"` >
 * `InputGroupButton`（右下角实心「提交」）。根壳覆写 `bg-transparent
 * border-border`——`InputGroup` 默认的 `bg-input/50` 是产品令牌，批注行底色却
 * 归 diff 引擎（选中行还会叠选中蓝），铺上去必然割裂。与展示态同样无填充，
 * 点「编辑」不产生背景跳变。
 *
 * 交互契约（草稿 / 编辑同构）：
 * - 只有「提交」一个按钮；无取消按钮。
 * - **空内容**离开编辑器（Tab 失焦 / 点编辑器外）→ `onEmptyDismiss`
 *   （缺省回退 `onCancel`）。草稿侧 = 收起空槽；编辑侧 = 删除该评论。
 * - **非空**离开 = 保留输入，不写入、不回调。
 * - diff 代码行多数不可聚焦，单靠 textarea `onBlur` 点不出去时不会触发——
 *   因此额外用 capture 期 `pointerdown` 做外点检测（与 blur 共用同一分流）。
 * - 挂载时聚焦并把光标放到正文末尾（编辑态接续改，而不是从头选中）。
 * - `Cmd/Ctrl+Enter` 提交；`Escape` 一律走 `onCancel`（放弃本次编辑 / 丢草稿，
 *   不因清空而删已有评论）。
 * - `onSubmit` 返回 boolean：true 表示已写入（调用方负责收起），
 *   false 保留用户输入不清空，失败反馈由 host 在回调内处理。
 */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "../../button.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "../../input-group.tsx";
import { Textarea } from "../../textarea.tsx";
import type {
  PierInlineReviewChrome,
  PierInlineReviewLabels,
} from "./inline-comment-types.ts";

export function InlineReviewCommentEditor({
  chrome = "card",
  initialBody = "",
  labels,
  onCancel,
  onEmptyDismiss,
  onSubmit,
}: {
  /**
   * `card` — Diff 槽：InputGroup 一体（字段+提交角标）。
   * `plain` — Popover 面板：shadcn 表单 = 带边框 Textarea + 下方提交。
   */
  readonly chrome?: PierInlineReviewChrome;
  readonly initialBody?: string;
  readonly labels: PierInlineReviewLabels;
  readonly onCancel: () => void;
  /**
   * 正文为空时失焦 / 外点。编辑态应删评论；草稿态通常与 `onCancel` 相同。
   * 未传时回退 `onCancel`。
   */
  readonly onEmptyDismiss?: () => void;
  readonly onSubmit: (body: string) => Promise<boolean>;
}): ReactNode {
  const plain = chrome === "plain";
  const [body, setBody] = useState(initialBody);
  const [submitting, setSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef(body);
  const submittingRef = useRef(submitting);
  const onCancelRef = useRef(onCancel);
  const onEmptyDismissRef = useRef(onEmptyDismiss);
  const canSubmit = body.trim().length > 0 && !submitting;

  bodyRef.current = body;
  submittingRef.current = submitting;
  onCancelRef.current = onCancel;
  onEmptyDismissRef.current = onEmptyDismiss;

  const dismissIfEmpty = useCallback(() => {
    if (submittingRef.current) {
      return;
    }
    if (bodyRef.current.trim().length === 0) {
      (onEmptyDismissRef.current ?? onCancelRef.current)();
    }
  }, []);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) {
      return;
    }
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  // diff 代码行不可聚焦时 blur 不会触发；用 capture 外点补上「空 = 收起」。
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = containerRef.current;
      if (root === null) {
        return;
      }
      const path = event.composedPath();
      if (path.includes(root)) {
        return;
      }
      dismissIfEmpty();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [dismissIfEmpty]);

  const handleSubmit = useCallback(async () => {
    if (body.trim().length === 0 || submitting) {
      return;
    }
    setSubmitting(true);
    const ok = await onSubmit(body.trim());
    setSubmitting(false);
    if (ok) {
      setBody("");
    }
  }, [body, onSubmit, submitting]);

  const onBlurField = (event: React.FocusEvent<HTMLTextAreaElement>): void => {
    const movingWithinEditor = containerRef.current?.contains(
      event.relatedTarget as Node
    );
    if (movingWithinEditor === true) {
      return;
    }
    dismissIfEmpty();
  };

  const onKeyDownField = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ): void => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleSubmit().catch(console.error);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  // Popover/Dialog: shadcn form pattern — bordered field, actions on the next row.
  // Popover is the panel; Textarea keeps normal control chrome (border + focus ring).
  if (plain) {
    return (
      <div className="flex w-full flex-col gap-2" ref={containerRef}>
        <Textarea
          aria-label={labels.title}
          className="field-sizing-content min-h-16 resize-none"
          onBlur={onBlurField}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDownField}
          placeholder={labels.inputPlaceholder}
          ref={textareaRef}
          value={body}
        />
        <div className="flex justify-end">
          <Button
            disabled={!canSubmit}
            onClick={() => {
              handleSubmit().catch(console.error);
            }}
            type="button"
            variant="default"
          >
            {labels.submit}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full" ref={containerRef}>
      <InputGroup className="border-border bg-transparent">
        <InputGroupTextarea
          aria-label={labels.title}
          className="field-sizing-content min-h-16 px-3 py-2.5"
          onBlur={onBlurField}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDownField}
          placeholder={labels.inputPlaceholder}
          ref={textareaRef}
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
            {labels.submit}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
