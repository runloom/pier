/**
 * Shared comment composer (git / markdown / canvas).
 *
 * Matches terminal rich-input chrome:
 * - compose (new): compact pill, Enter submits, Shift+Enter grows to multiline
 * - edit: expanded card, newline on Enter, footer 删除 | 取消 | 保存
 */
import { ArrowUp, Trash2 } from "lucide-react";
import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "../button.tsx";
import type { PierInlineReviewLabels } from "../diff-view/review/inline-comment-types.ts";
import { Textarea } from "../textarea.tsx";
import { cn } from "../utils.ts";

const COMPACT_TEXTAREA_STYLE: CSSProperties = {
  fieldSizing: "fixed",
  height: 28,
  lineHeight: "20px",
  maxHeight: 28,
  minHeight: 28,
  overflow: "hidden",
  whiteSpace: "nowrap",
};

function fieldOverflows(el: HTMLTextAreaElement): boolean {
  return (
    el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
  );
}

export type CommentComposerMode = "compose" | "edit";
export type CommentComposerSurface = "overlay" | "plain";

export function CommentComposer({
  autoFocus = true,
  initialBody = "",
  labels,
  mode,
  onCancel,
  onDelete,
  onEmptyDismiss,
  onSubmit,
  surface = "overlay",
}: {
  readonly autoFocus?: boolean;
  readonly initialBody?: string;
  readonly labels: PierInlineReviewLabels;
  readonly mode: CommentComposerMode;
  readonly onCancel: () => void;
  readonly onDelete?: () => void;
  readonly onEmptyDismiss?: () => void;
  readonly onSubmit: (body: string) => Promise<boolean>;
  readonly surface?: CommentComposerSurface;
}): ReactNode {
  const editing = mode === "edit";
  const [body, setBody] = useState(initialBody);
  const [submitting, setSubmitting] = useState(false);
  const [grown, setGrown] = useState(editing);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const restoreCaretRef = useRef<number | null>(null);
  const bodyRef = useRef(body);
  const submittingRef = useRef(submitting);
  const onCancelRef = useRef(onCancel);
  const onEmptyDismissRef = useRef(onEmptyDismiss);
  const canSubmit = body.trim().length > 0 && !submitting;
  // Newline must expand on the same render; compact `rounded-full` on a tall
  // box punches transparent corners through the overlay.
  const expanded = editing || grown || body.includes("\n");
  const overlay = surface === "overlay";

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
    if (!autoFocus) {
      return;
    }
    const el = textareaRef.current;
    if (el === null) {
      return;
    }
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [autoFocus]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) {
      return;
    }
    const pos = restoreCaretRef.current;
    if (pos !== null) {
      el.setSelectionRange(pos, pos);
      restoreCaretRef.current = null;
    }
    if (editing) {
      setGrown(true);
      return;
    }
    if (body.includes("\n")) {
      setGrown(true);
      return;
    }
    if (body.length === 0) {
      setGrown(false);
      return;
    }
    if (grown) {
      return;
    }
    if (fieldOverflows(el)) {
      setGrown(true);
    }
  }, [body, editing, grown]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = containerRef.current;
      if (root === null || event.composedPath().includes(root)) {
        return;
      }
      if (editing) {
        return;
      }
      dismissIfEmpty();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [dismissIfEmpty, editing]);

  const handleSubmit = useCallback(async () => {
    const trimmed = bodyRef.current.trim();
    if (trimmed.length === 0 || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const ok = await onSubmit(trimmed);
      if (ok) {
        setBody("");
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [onSubmit]);

  const onBlurField = (event: FocusEvent<HTMLTextAreaElement>): void => {
    if (editing) {
      return;
    }
    const movingWithinEditor = containerRef.current?.contains(
      event.relatedTarget as Node
    );
    if (movingWithinEditor === true) {
      return;
    }
    dismissIfEmpty();
  };

  const onKeyDownField = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter" && event.shiftKey) {
      if (editing) {
        return;
      }
      event.preventDefault();
      const el = event.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = `${el.value.slice(0, start)}\n${el.value.slice(end)}`;
      restoreCaretRef.current = start + 1;
      setBody(next);
      setGrown(true);
      return;
    }
    if (event.key !== "Enter") {
      return;
    }
    if (editing) {
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        handleSubmit().catch(console.error);
      }
      return;
    }
    event.preventDefault();
    handleSubmit().catch(console.error);
  };

  const sendButton = (
    <Button
      aria-label={labels.submit}
      className="rounded-full"
      disabled={!canSubmit}
      onClick={() => {
        handleSubmit().catch(console.error);
      }}
      size="icon-xs"
      type="button"
      variant="default"
    >
      <ArrowUp data-icon />
    </Button>
  );

  return (
    <div
      className={cn(
        "min-w-0 border border-border outline-none",
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
        overlay
          ? "w-72 max-w-[min(20rem,100%)] bg-background shadow-sm"
          : "w-full bg-background shadow-sm",
        expanded ? "rounded-2xl" : "rounded-full"
      )}
      data-expanded={expanded ? "" : undefined}
      data-mode={mode}
      data-slot="comment-composer"
      ref={containerRef}
    >
      <div
        className={cn(
          "flex min-w-0 overflow-hidden",
          expanded
            ? "flex-col rounded-2xl"
            : "flex-row items-center rounded-full"
        )}
      >
        <Textarea
          aria-label={labels.title}
          className={cn(
            "resize-none rounded-none border-0 bg-transparent text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0",
            expanded
              ? "field-sizing-content max-h-32 min-h-16 w-full px-3 py-2 leading-5"
              : "field-sizing-fixed h-7 max-h-7 min-h-7 min-w-0 flex-1 overflow-hidden whitespace-nowrap px-3 py-1 leading-5"
          )}
          onBlur={onBlurField}
          onChange={(event) => {
            const next = event.target.value;
            setBody(next);
            if (editing) {
              return;
            }
            if (next.includes("\n") || fieldOverflows(event.target)) {
              setGrown(true);
              return;
            }
            if (next.length === 0) {
              setGrown(false);
            }
          }}
          onKeyDown={onKeyDownField}
          placeholder={labels.inputPlaceholder}
          ref={textareaRef}
          rows={expanded ? 3 : 1}
          value={body}
          wrap={expanded ? "soft" : "off"}
          {...(expanded ? {} : { style: COMPACT_TEXTAREA_STYLE })}
        />
        {editing ? (
          <div className="flex items-center gap-1 px-2 pt-0.5 pb-2">
            {onDelete ? (
              <Button
                aria-label={labels.deleteComment}
                onClick={onDelete}
                size="icon"
                title={labels.deleteComment}
                tone="muted"
                type="button"
                variant="ghost"
              >
                <Trash2 data-icon />
              </Button>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <Button onClick={onCancel} type="button" variant="outline">
                {labels.cancel}
              </Button>
              <Button
                disabled={!canSubmit}
                onClick={() => {
                  handleSubmit().catch(console.error);
                }}
                type="button"
                variant="default"
              >
                {labels.save}
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "flex shrink-0 items-center",
              expanded ? "justify-end px-2 pt-0.5 pb-2" : "pr-1"
            )}
          >
            {sendButton}
          </div>
        )}
      </div>
    </div>
  );
}
