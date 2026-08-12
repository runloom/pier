/**
 * Markdown 块评论壳：与 diff 行内评论同构。
 *
 * - 无评论：左缘评论图标（hover/focus 显现；垂直对齐首行中线）
 * - 有评论：块下常驻 InlineReviewThreadCard（无第二套装饰标）
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { MessageSquare } from "lucide-react";
import type { ReactNode } from "react";

/** 左缘 overlay 槽宽（px）；热区 28，glyph 略放大。 */
export const MARKDOWN_COMMENT_GUTTER_PX = 28;

const GUTTER_OPACITY_REVEAL_CLASS =
  "opacity-0 transition-opacity group-focus-within/md-comment:opacity-100 group-hover/md-comment:opacity-100";

/** Apply on the hit target so an opacity-0 control cannot steal clicks. */
const GUTTER_POINTER_REVEAL_CLASS =
  "pointer-events-none group-focus-within/md-comment:pointer-events-auto group-hover/md-comment:pointer-events-auto";

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
  readonly threads: readonly PierInlineReviewThread[];
}): ReactNode {
  const draftId = props.draftId;
  const draftOpen = draftId !== null;
  // 仅「无线程且无草稿」时显示入口；有评论只靠块下卡片。
  const showAdd = props.threads.length === 0 && !draftOpen;

  return (
    <div
      className="group/md-comment relative"
      data-markdown-comment-block={props.blockKey}
      data-slot="markdown-comment-block"
    >
      <div className="relative min-w-0">
        {props.children}
        {showAdd ? (
          <div
            className="absolute top-0 z-10 flex items-center justify-center"
            data-slot="markdown-comment-gutter"
            style={{
              // 贴在正文左外侧；高度由 prose.css 按首行盒对齐。
              right: "100%",
              width: MARKDOWN_COMMENT_GUTTER_PX,
            }}
          >
            <Tooltip>
              {/*
                span carries the trigger ref. Button is not forwardRef, so
                Radix cannot anchor the tooltip if asChild is on Button.
              */}
              <TooltipTrigger asChild>
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
              </TooltipTrigger>
              {/*
                Icon sits in the left gutter; open tooltip toward the prose
                (right). Keep sideOffset tight (default product offset is 6) so
                the label sits close to the icon without a large gap.
              */}
              <TooltipContent align="center" side="right" sideOffset={2}>
                {props.addCommentLabel}
              </TooltipContent>
            </Tooltip>
          </div>
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
      {draftId === null && props.threads.length > 0 ? (
        <div
          className="mt-1.5 flex flex-col gap-1.5"
          data-slot="markdown-comment-thread"
        >
          {props.threads.map((thread) => (
            <InlineReviewThreadCard
              handlers={props.handlers}
              key={thread.threadId}
              labels={props.labels}
              thread={thread}
            />
          ))}
        </div>
      ) : null}
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
