/**
 * Canvas 评论叠层（Design Mode）：
 * - 仅对「仍有 DOM + 已有线程」的声明 anchor 显示轻徽标
 * - 点选草稿用壳内浮层编辑器，不在无 id 节点上乱钉
 * - pick 模式时顶部提示条
 */
import { InlineReviewCommentEditor } from "@pier/ui/diff-view/review/inline-comment-editor.tsx";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import { findCanvasCommentAnchorElement } from "@shared/comments/canvas-anchor.ts";
import { MessageSquare } from "lucide-react";
import { type ReactNode, useLayoutEffect, useState } from "react";
import type { CanvasElementPick } from "./canvas-element-pick.ts";
import type { CanvasCommentThreadView } from "./use-canvas-preview-comments.ts";
import { CANVAS_PICK_DRAFT_ID } from "./use-canvas-preview-comments.ts";

interface BadgeBox {
  readonly id: string;
  readonly left: number;
  readonly top: number;
}

function measureBadges(
  host: HTMLElement,
  shell: HTMLElement,
  locatedByAnchorId: ReadonlyMap<string, CanvasCommentThreadView[]>
): BadgeBox[] {
  const shellRect = shell.getBoundingClientRect();
  const boxes: BadgeBox[] = [];
  for (const id of locatedByAnchorId.keys()) {
    const el = findCanvasCommentAnchorElement(host, id);
    if (!el) {
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) {
      continue;
    }
    boxes.push({
      id,
      left: rect.right - shellRect.left + shell.scrollLeft - 12,
      top: rect.top - shellRect.top + shell.scrollTop - 4,
    });
  }
  return boxes;
}

export function CanvasCommentOverlay(props: {
  readonly draftOpen: boolean;
  readonly draftPick: CanvasElementPick | null;
  readonly handlers: PierInlineReviewHandlers;
  readonly host: HTMLElement | null;
  readonly labels: PierInlineReviewLabels & {
    readonly annotateActive?: string;
  };
  readonly locatedByAnchorId: ReadonlyMap<string, CanvasCommentThreadView[]>;
  readonly pickMode: boolean;
  readonly shell: HTMLElement | null;
}): ReactNode {
  const { host, locatedByAnchorId, shell } = props;
  const [badges, setBadges] = useState<readonly BadgeBox[]>([]);

  useLayoutEffect(() => {
    if (!(host && shell)) {
      setBadges([]);
      return;
    }
    const update = () => {
      setBadges(measureBadges(host, shell, locatedByAnchorId));
    };
    update();
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            update();
          });
    ro?.observe(host);
    ro?.observe(shell);
    host.addEventListener("scroll", update, { passive: true });
    shell.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      host.removeEventListener("scroll", update);
      shell.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [host, locatedByAnchorId, shell]);

  const showPickDraft = props.draftOpen && props.draftPick !== null;
  const pickHint = props.labels.annotateActive ?? "Click an element to comment";

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      data-slot="canvas-comment-overlay"
    >
      {props.pickMode && !showPickDraft ? (
        <div
          className="pointer-events-none absolute top-2 right-2 left-2 z-20 flex justify-center"
          data-slot="canvas-comment-pick-chrome"
        >
          <p className="rounded-md border border-border bg-background/95 px-3 py-1.5 text-muted-foreground text-xs shadow-sm">
            {pickHint}
          </p>
        </div>
      ) : null}
      {badges.map((box) => (
        <span
          aria-hidden
          className="pointer-events-none absolute inline-flex size-5 items-center justify-center rounded-full bg-background text-action-accent shadow-sm ring-1 ring-border"
          data-canvas-comment-badge={box.id}
          key={box.id}
          style={{ left: box.left, top: box.top }}
          title={props.labels.title}
        >
          <MessageSquare aria-hidden className="size-3" />
        </span>
      ))}
      {showPickDraft ? (
        <div
          className="pointer-events-auto absolute right-4 bottom-4 z-20 w-80 max-w-[calc(100%-2rem)]"
          data-slot="canvas-comment-pick-chrome"
        >
          {props.draftPick ? (
            <p className="mb-1.5 truncate rounded-md border border-border bg-muted/40 px-2 py-1 text-muted-foreground text-xs">
              {props.draftPick.label}
            </p>
          ) : null}
          <InlineReviewCommentEditor
            labels={props.labels}
            onCancel={() => props.handlers.onCancelDraft(CANVAS_PICK_DRAFT_ID)}
            onSubmit={async (body) =>
              props.handlers.onSubmitDraft(CANVAS_PICK_DRAFT_ID, body)
            }
          />
        </div>
      ) : null}
    </div>
  );
}
