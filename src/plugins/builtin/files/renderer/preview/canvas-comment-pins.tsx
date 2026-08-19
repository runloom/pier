/**
 * Canvas comment pins: hover shows the comment body; click opens edit.
 * Trigger is absolutely positioned; hover/edit floaters are portaled so the
 * preview frame's overflow cannot clip them or cover the pin on the document.
 */

import { CommentComposer } from "@pier/ui/comments/composer.tsx";
import {
  CommentCountBadge,
  CommentCountBadgeStatic,
} from "@pier/ui/comments/count-badge.tsx";
import {
  COMMENT_FLOATER_CONTENT_CLASS,
  COMMENT_FLOATER_POSITION,
  COMMENT_HOVER_CARD_CLASS,
  CommentHoverPreview,
} from "@pier/ui/comments/hover-preview.tsx";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import { InlineReviewThreadCard } from "@pier/ui/diff-view/review/inline-thread-card.tsx";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@pier/ui/hover-card.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@pier/ui/popover.tsx";
import { cn } from "@pier/ui/utils.ts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CanvasCommentThreadView } from "./use-canvas-preview-comments.ts";

export interface CanvasCommentPinView {
  readonly index: number;
  readonly key: string;
  readonly left: number;
  readonly threads: readonly CanvasCommentThreadView[];
  readonly title: string;
  readonly top: number;
}

/** Bubble sits on the top-right corner; tail (bottom-left) points at the box. */
const PIN_POSITION_CLASS = "absolute z-30 -translate-x-1/4 -translate-y-[70%]";

function threadHoverItems(
  threads: readonly CanvasCommentThreadView[]
): readonly { readonly body: string; readonly id: string }[] {
  return threads.map((thread) => ({
    body: thread.comment.body,
    id: thread.threadId,
  }));
}

function CanvasCommentPinPopoverBody(props: {
  readonly editEpoch: number;
  readonly handlers: PierInlineReviewHandlers;
  readonly labels: PierInlineReviewLabels;
  readonly onClose: () => void;
  readonly pin: CanvasCommentPinView;
}): ReactNode {
  const onEditComment = props.handlers.onEditComment;
  if (props.pin.threads.length > 0 && onEditComment) {
    return (
      <div className="flex flex-col gap-2">
        {props.pin.threads.map((thread) => (
          <CommentComposer
            initialBody={thread.comment.body}
            key={`${thread.threadId}-${props.editEpoch}`}
            labels={props.labels}
            mode="edit"
            onCancel={props.onClose}
            onDelete={async () => {
              const ok = await props.handlers.onDeleteComment(
                thread.threadId,
                thread.comment.id
              );
              if (ok) {
                props.onClose();
              }
            }}
            onSubmit={async (body) => {
              const ok = await onEditComment(
                thread.threadId,
                thread.comment.id,
                body
              );
              if (ok) {
                props.onClose();
              }
              return ok;
            }}
          />
        ))}
      </div>
    );
  }
  if (props.pin.threads.length > 0) {
    return (
      <>
        {props.pin.threads.map((thread) => (
          <InlineReviewThreadCard
            chrome="plain"
            handlers={props.handlers}
            key={thread.threadId}
            labels={props.labels}
            thread={thread}
          />
        ))}
      </>
    );
  }
  return <p className="text-muted-foreground text-xs">{props.pin.title}</p>;
}

export function CanvasCommentPinLayer(props: {
  readonly handlers: PierInlineReviewHandlers;
  /** When false (draft overlay), pins are display-only. Pick mode stays live. */
  readonly interactive: boolean;
  readonly labels: PierInlineReviewLabels;
  /** Notify when the user opens a pin so n/N can match the pin number. */
  readonly onPinOpen?: ((pin: CanvasCommentPinView) => void) | undefined;
  /** Request open after pick-on-existing (applied once interactive). */
  readonly onRequestOpenConsumed?: () => void;
  /** When true, open the pin's thread(s) in edit mode. */
  readonly openInEditMode?: boolean;
  readonly pins: readonly CanvasCommentPinView[];
  readonly requestOpenKey?: string | null;
  /** Parent bumps this on canvas scroll to close open pin popovers. */
  readonly scrollDismissEpoch?: number;
}): ReactNode {
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Bumps when opening so composers remount with the latest body. */
  const [editEpoch, setEditEpoch] = useState(0);

  // Apply programmatic open once pins can receive pointer events.
  useEffect(() => {
    if (!props.interactive) {
      setOpenKey(null);
      return;
    }
    if (props.requestOpenKey) {
      setOpenKey(props.requestOpenKey);
      if (props.openInEditMode === true) {
        setEditEpoch((value) => value + 1);
      }
      props.onRequestOpenConsumed?.();
    }
  }, [
    props.interactive,
    props.onRequestOpenConsumed,
    props.openInEditMode,
    props.requestOpenKey,
  ]);

  // Close pin detail/edit when the canvas scrolls (anchor moved under portal).
  const prevScrollDismissEpochRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (props.scrollDismissEpoch === undefined) {
      return;
    }
    if (prevScrollDismissEpochRef.current === undefined) {
      prevScrollDismissEpochRef.current = props.scrollDismissEpoch;
      return;
    }
    if (prevScrollDismissEpochRef.current === props.scrollDismissEpoch) {
      return;
    }
    prevScrollDismissEpochRef.current = props.scrollDismissEpoch;
    setOpenKey(null);
    // ref is stable; only re-run when the parent bumps the epoch on scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [props.scrollDismissEpoch]);

  if (props.pins.length === 0) {
    return null;
  }

  return (
    <>
      {props.pins.map((pin) => {
        const label = pin.index;
        if (!props.interactive) {
          return (
            <span
              className={cn("pointer-events-none", PIN_POSITION_CLASS)}
              data-canvas-comment-pin={pin.index}
              key={pin.key}
              style={{ left: pin.left, top: pin.top }}
            >
              <CommentCountBadgeStatic count={label} />
            </span>
          );
        }

        const open = openKey === pin.key;
        const hoverItems = threadHoverItems(pin.threads);

        return (
          <div
            className={cn(
              "pointer-events-auto cursor-pointer",
              PIN_POSITION_CLASS
            )}
            data-canvas-comment-pin={pin.index}
            key={pin.key}
            style={{ left: pin.left, top: pin.top }}
          >
            <HoverCard
              closeDelay={50}
              openDelay={0}
              {...(open ? { open: false } : {})}
            >
              <Popover
                onOpenChange={(next) => {
                  setOpenKey(next ? pin.key : null);
                  if (next) {
                    setEditEpoch((value) => value + 1);
                    props.onPinOpen?.(pin);
                  }
                }}
                open={open}
              >
                <HoverCardTrigger asChild>
                  <PopoverTrigger asChild>
                    <CommentCountBadge
                      aria-label={pin.title}
                      className={cn(open && "brightness-110")}
                      count={label}
                    />
                  </PopoverTrigger>
                </HoverCardTrigger>
                <PopoverContent
                  className={COMMENT_FLOATER_CONTENT_CLASS}
                  {...COMMENT_FLOATER_POSITION}
                >
                  <CanvasCommentPinPopoverBody
                    editEpoch={editEpoch}
                    handlers={props.handlers}
                    labels={props.labels}
                    onClose={() => setOpenKey(null)}
                    pin={pin}
                  />
                </PopoverContent>
              </Popover>
              {hoverItems.length > 0 ? (
                <HoverCardContent
                  className={COMMENT_HOVER_CARD_CLASS}
                  {...COMMENT_FLOATER_POSITION}
                >
                  <CommentHoverPreview items={hoverItems} />
                </HoverCardContent>
              ) : null}
            </HoverCard>
          </div>
        );
      })}
    </>
  );
}
