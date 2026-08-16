/**
 * Markdown 块评论壳：阅读态不占版心。
 *
 * - 无评论：左缘评论图标（hover/focus 显现；垂直对齐首行中线）
 * - 有评论：左缘常驻徽标；点开 Popover 才见 InlineReviewThreadCard
 * - 草稿：块下 InlineReviewCommentEditor；不显示入口
 * - overlay 左缘，不占版心、不挤正文
 */
import { Button } from "@pier/ui/button.tsx";
import { InlineReviewCommentEditor } from "@pier/ui/diff-view/review/inline-comment-editor.tsx";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import { InlineReviewThreadCard } from "@pier/ui/diff-view/review/inline-thread-card.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@pier/ui/popover.tsx";
import { cn } from "@pier/ui/utils.ts";
import { MessageSquare } from "lucide-react";
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
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly suppressAutoFocus: boolean;
  readonly threads: readonly PierInlineReviewThread[];
  readonly viewLabel: string;
}): ReactNode {
  const count = props.threads.length;
  if (count === 0) {
    return null;
  }

  return (
    <MarkdownCommentGutterSlot>
      <Popover onOpenChange={props.onOpenChange} open={props.open}>
        <PopoverTrigger asChild>
          <Button
            aria-label={props.viewLabel}
            className={cn(props.open && "ring-2 ring-background")}
            data-slot="markdown-comment-badge"
            size="icon-xs"
            type="button"
            variant="default"
          >
            {count > 1 ? (
              <span className="font-semibold text-[10px] tabular-nums">
                {count}
              </span>
            ) : (
              <MessageSquare aria-hidden data-icon />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={props.viewLabel}
          className="w-72 gap-2 p-3"
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            if (props.suppressAutoFocus) {
              event.preventDefault();
            }
          }}
          side="right"
          sideOffset={6}
        >
          <div
            className="flex flex-col gap-2"
            data-slot="markdown-comment-thread"
          >
            {props.threads.map((thread) => (
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
    </MarkdownCommentGutterSlot>
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
  // 仅「无线程且无草稿」时显示入口；有评论只靠左缘徽标。
  const showAdd = !(hasThreads || draftOpen);
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
      className="group/md-comment relative"
      data-markdown-comment-block={props.blockKey}
      data-slot="markdown-comment-block"
    >
      <div
        className={cn(
          "relative min-w-0",
          open && "rounded-md ring-1 ring-ring/40"
        )}
      >
        {props.children}
        {showAdd ? (
          <MarkdownCommentGutterSlot>
            <span
              className={cn(
                "inline-flex",
                GUTTER_OPACITY_REVEAL_CLASS,
                GUTTER_POINTER_REVEAL_CLASS
              )}
            >
              <Button
                aria-label={props.addCommentLabel}
                className={cn(
                  GUTTER_POINTER_REVEAL_CLASS,
                  "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onOpenDraft();
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <MessageSquare aria-hidden data-icon />
              </Button>
            </span>
          </MarkdownCommentGutterSlot>
        ) : null}
        {hasThreads && !draftOpen ? (
          <MarkdownCommentLocatedBadge
            handlers={props.handlers}
            labels={props.labels}
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
        ) : null}
      </div>
      {draftId === null ? null : (
        <div className="mt-1.5" data-slot="markdown-comment-draft">
          <InlineReviewCommentEditor
            labels={props.labels}
            onCancel={() => props.handlers.onCancelDraft(draftId)}
            onSubmit={async (body) =>
              props.handlers.onSubmitDraft(draftId, body)
            }
          />
        </div>
      )}
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
