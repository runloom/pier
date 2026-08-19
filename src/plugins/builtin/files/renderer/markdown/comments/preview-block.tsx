/**
 * Markdown 块评论壳：阅读态不占版心。
 *
 * - 无评论：左缘评论图标（hover/focus 显现；垂直对齐首行中线）
 * - 有评论：左缘常驻计数气泡（固定最左侧，不叠在正文上）
 *   悬停预览正文；点击进入共享编辑输入
 * - 草稿：优先贴在左缘图标右侧；空间不够时走 Radix 碰撞翻转，不画出界面
 */
import { Button } from "@pier/ui/button.tsx";
import { CommentComposer } from "@pier/ui/comments/composer.tsx";
import { CommentCountBadge } from "@pier/ui/comments/count-badge.tsx";
import {
  COMMENT_FLOATER_CONTENT_CLASS,
  COMMENT_FLOATER_POSITION,
  COMMENT_HOVER_CARD_CLASS,
  CommentHoverPreview,
} from "@pier/ui/comments/hover-preview.tsx";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import { InlineReviewThreadCard } from "@pier/ui/diff-view/review/inline-thread-card.tsx";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@pier/ui/hover-card.tsx";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@pier/ui/popover.tsx";
import { cn } from "@pier/ui/utils.ts";
import { MessageCircle } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

/** 左缘 overlay 槽宽（px）；热区 28，glyph 略放大。 */
export const MARKDOWN_COMMENT_GUTTER_PX = 28;

const GUTTER_OPACITY_REVEAL_CLASS =
  "opacity-0 transition-opacity group-focus-within/md-comment:opacity-100 group-hover/md-comment:opacity-100";

/** Apply on the hit target so an opacity-0 control cannot steal clicks. */
const GUTTER_POINTER_REVEAL_CLASS =
  "pointer-events-none group-focus-within/md-comment:pointer-events-auto group-hover/md-comment:pointer-events-auto";

const GUTTER_SLOT_CLASS =
  "absolute top-0 z-10 flex items-center justify-center";

export function markdownCommentViewLabel(input: {
  readonly count: number;
  readonly viewComment: string;
  readonly viewComments: string;
}): string {
  if (input.count <= 1) {
    return input.viewComment;
  }
  return input.viewComments.replaceAll("{{count}}", String(input.count));
}

function MarkdownCommentGutterSlot(props: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      className={GUTTER_SLOT_CLASS}
      data-slot="markdown-comment-gutter"
      style={{
        // 贴在正文左外侧；高度由 prose.css 按首行盒对齐。
        right: "100%",
        width: MARKDOWN_COMMENT_GUTTER_PX,
      }}
    >
      {props.children}
    </div>
  );
}

function MarkdownCommentLocatedBadge(props: {
  readonly handlers: PierInlineReviewHandlers;
  readonly labels: PierInlineReviewLabels;
  readonly markerIndex: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly suppressAutoFocus: boolean;
  readonly threads: readonly PierInlineReviewThread[];
  readonly viewLabel: string;
}): ReactNode {
  const count = props.threads.length;
  const markerIndex = props.markerIndex > 0 ? props.markerIndex : 1;
  const onEditComment = props.handlers.onEditComment;
  const [editEpoch, setEditEpoch] = useState(0);
  if (count === 0) {
    return null;
  }

  return (
    <div data-slot="markdown-comment-anchor">
      <HoverCard
        closeDelay={50}
        openDelay={0}
        {...(props.open ? { open: false } : {})}
      >
        <Popover
          onOpenChange={(next) => {
            props.onOpenChange(next);
            if (next) {
              setEditEpoch((value) => value + 1);
            }
          }}
          open={props.open}
        >
          <HoverCardTrigger asChild>
            <PopoverTrigger asChild>
              <CommentCountBadge
                aria-label={props.viewLabel}
                count={markerIndex}
                data-slot="markdown-comment-badge"
              />
            </PopoverTrigger>
          </HoverCardTrigger>
          <PopoverContent
            aria-label={props.viewLabel}
            className={COMMENT_FLOATER_CONTENT_CLASS}
            onOpenAutoFocus={(event) => {
              if (props.suppressAutoFocus) {
                event.preventDefault();
              }
            }}
            {...COMMENT_FLOATER_POSITION}
          >
            <div
              className="flex flex-col gap-2"
              data-slot="markdown-comment-thread"
            >
              {onEditComment
                ? props.threads.map((thread) => (
                    <CommentComposer
                      autoFocus={!props.suppressAutoFocus}
                      initialBody={thread.comment.body}
                      key={`${thread.threadId}-${editEpoch}`}
                      labels={props.labels}
                      mode="edit"
                      onCancel={() => props.onOpenChange(false)}
                      onDelete={async () => {
                        const ok = await props.handlers.onDeleteComment(
                          thread.threadId,
                          thread.comment.id
                        );
                        if (ok) {
                          props.onOpenChange(false);
                        }
                      }}
                      onSubmit={async (body) => {
                        const ok = await onEditComment(
                          thread.threadId,
                          thread.comment.id,
                          body
                        );
                        if (ok) {
                          props.onOpenChange(false);
                        }
                        return ok;
                      }}
                    />
                  ))
                : props.threads.map((thread) => (
                    <InlineReviewThreadCard
                      chrome="plain"
                      handlers={props.handlers}
                      key={thread.threadId}
                      labels={props.labels}
                      thread={thread}
                    />
                  ))}
            </div>
          </PopoverContent>
        </Popover>
        <HoverCardContent
          className={COMMENT_HOVER_CARD_CLASS}
          {...COMMENT_FLOATER_POSITION}
        >
          <CommentHoverPreview
            items={props.threads.map((thread) => ({
              body: thread.comment.body,
              id: thread.threadId,
            }))}
          />
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}

export function MarkdownCommentBlockShell(props: {
  readonly addCommentLabel: string;
  readonly blockKey: string;
  readonly children: ReactNode;
  /**
   * Stable draft id (contentHash). When non-null, this block shows the draft
   * editor; cancel/submit use this id (not IR offset keys).
   */
  readonly draftId: string | null;
  readonly handlers: PierInlineReviewHandlers;
  readonly labels: PierInlineReviewLabels;
  /** 1-based document-order pin number (Codex); not the per-block thread count. */
  readonly markerIndex: number;
  readonly onOpenDraft: () => void;
  readonly requestOpenBlockKey?: string | null;
  readonly requestOpenNonce?: number;
  readonly threads: readonly PierInlineReviewThread[];
  readonly viewCommentLabel: string;
  readonly viewCommentsLabel: string;
}): ReactNode {
  const draftId = props.draftId;
  const draftOpen = draftId !== null;
  const hasThreads = props.threads.length > 0;
  // 无线程时左缘保持添加入口；草稿打开后图标仍在，输入贴在图标右侧。
  const showAdd = !hasThreads;
  const [open, setOpen] = useState(false);
  const [openedByNavigator, setOpenedByNavigator] = useState(false);
  const viewLabel = markdownCommentViewLabel({
    count: props.threads.length,
    viewComment: props.viewCommentLabel,
    viewComments: props.viewCommentsLabel,
  });

  useEffect(() => {
    if ((props.requestOpenNonce ?? 0) === 0) {
      return;
    }
    if (props.requestOpenBlockKey === props.blockKey) {
      if (hasThreads) {
        setOpenedByNavigator(true);
        setOpen(true);
      }
      return;
    }
    setOpenedByNavigator(false);
    setOpen(false);
  }, [
    hasThreads,
    props.blockKey,
    props.requestOpenBlockKey,
    props.requestOpenNonce,
  ]);

  useEffect(() => {
    if (!hasThreads) {
      setOpenedByNavigator(false);
      setOpen(false);
    }
  }, [hasThreads]);

  return (
    <div
      className={cn("group/md-comment relative", draftOpen && "z-20")}
      data-markdown-comment-block={props.blockKey}
      data-slot="markdown-comment-block"
    >
      <div className="relative min-w-0">
        {props.children}
        {showAdd ? (
          <MarkdownCommentGutterSlot>
            <Popover open={draftOpen}>
              <PopoverAnchor asChild>
                <span
                  className={cn(
                    "inline-flex",
                    !draftOpen && GUTTER_OPACITY_REVEAL_CLASS,
                    !draftOpen && GUTTER_POINTER_REVEAL_CLASS
                  )}
                >
                  <Button
                    aria-label={props.addCommentLabel}
                    className={cn(
                      !draftOpen && GUTTER_POINTER_REVEAL_CLASS,
                      "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!draftOpen) {
                        props.onOpenDraft();
                      }
                    }}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <MessageCircle aria-hidden data-icon />
                  </Button>
                </span>
              </PopoverAnchor>
              {draftId === null ? null : (
                <PopoverContent
                  className={COMMENT_FLOATER_CONTENT_CLASS}
                  onFocusOutside={(event) => {
                    event.preventDefault();
                  }}
                  onPointerDownOutside={(event) => {
                    event.preventDefault();
                  }}
                  {...COMMENT_FLOATER_POSITION}
                >
                  <div data-slot="markdown-comment-draft">
                    <CommentComposer
                      labels={props.labels}
                      mode="compose"
                      onCancel={() => props.handlers.onCancelDraft(draftId)}
                      onSubmit={async (body) =>
                        props.handlers.onSubmitDraft(draftId, body)
                      }
                    />
                  </div>
                </PopoverContent>
              )}
            </Popover>
          </MarkdownCommentGutterSlot>
        ) : null}
        {hasThreads ? (
          <MarkdownCommentGutterSlot>
            <MarkdownCommentLocatedBadge
              handlers={props.handlers}
              labels={props.labels}
              markerIndex={props.markerIndex}
              onOpenChange={(next) => {
                setOpen(next);
                if (!next) {
                  setOpenedByNavigator(false);
                }
              }}
              open={open}
              suppressAutoFocus={openedByNavigator}
              threads={props.threads}
              viewLabel={viewLabel}
            />
          </MarkdownCommentGutterSlot>
        ) : null}
      </div>
    </div>
  );
}

export function MarkdownCommentDriftStrip(props: {
  readonly comments: readonly {
    readonly excerpt: string;
    readonly thread: PierInlineReviewThread;
    readonly threadId: string;
  }[];
  readonly handlers: PierInlineReviewHandlers;
  readonly labels: PierInlineReviewLabels;
  readonly title: string;
}): ReactNode {
  if (props.comments.length === 0) {
    return null;
  }
  return (
    <div
      className="mb-4 rounded-lg border border-border bg-muted/30 px-3 py-2"
      data-markdown-comment-drift=""
      data-slot="markdown-comment-drift"
    >
      <p className="mb-2 font-medium text-muted-foreground text-xs">
        {props.title}
      </p>
      <ul className="flex flex-col gap-2">
        {props.comments.map((item) => (
          <li key={item.threadId}>
            <p className="mb-1 line-clamp-2 text-muted-foreground text-xs">
              {item.excerpt}
            </p>
            <InlineReviewThreadCard
              handlers={props.handlers}
              labels={props.labels}
              thread={item.thread}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
