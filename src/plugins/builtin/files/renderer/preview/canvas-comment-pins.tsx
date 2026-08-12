/**
 * Canvas comment pins: numbered disc + shadcn Popover for thread detail.
 * Trigger is absolutely positioned; Content is portaled (collision-aware).
 * Supports programmatic open when pick hits an already-commented element.
 */

import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
} from "@pier/ui/diff-view/review/inline-comment-types.ts";
import { InlineReviewThreadCard } from "@pier/ui/diff-view/review/inline-thread-card.tsx";
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

/** Disc sits on the top-right corner (anchor = box corner; translate half outside). */
const PIN_POSITION_CLASS = "absolute z-20 -translate-x-1/4 -translate-y-1/2";

const PIN_BUTTON_CLASS =
  "flex size-4 select-none items-center justify-center rounded-full bg-action-accent font-semibold text-[9px] text-action-accent-foreground tabular-nums leading-none shadow-sm ring-2 ring-background hover:brightness-110 focus-visible:outline-none focus-visible:ring-ring/40";

export function CanvasCommentPinLayer(props: {
  readonly handlers: PierInlineReviewHandlers;
  /** When false (pick mode / draft), pins are display-only. */
  readonly interactive: boolean;
  readonly labels: PierInlineReviewLabels;
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
  const [editOnOpen, setEditOnOpen] = useState(false);
  /** Bumps when opening in edit so ThreadCard remounts with initialEditing. */
  const [editEpoch, setEditEpoch] = useState(0);

  // Apply programmatic open when pins are interactive (after exiting pick mode).
  useEffect(() => {
    if (!props.interactive) {
      setOpenKey(null);
      setEditOnOpen(false);
      return;
    }
    if (props.requestOpenKey) {
      setOpenKey(props.requestOpenKey);
      const wantEdit = props.openInEditMode === true;
      setEditOnOpen(wantEdit);
      if (wantEdit) {
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
    setEditOnOpen(false);
    // ref is stable; only re-run when the parent bumps the epoch on scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [props.scrollDismissEpoch]);

  if (props.pins.length === 0) {
    return null;
  }

  return (
    <>
      {props.pins.map((pin) => {
        const label = String(pin.index);
        if (!props.interactive) {
          return (
            <span
              aria-hidden
              className={cn(
                "pointer-events-none",
                PIN_POSITION_CLASS,
                PIN_BUTTON_CLASS
              )}
              data-canvas-comment-pin={pin.index}
              key={pin.key}
              style={{ left: pin.left, top: pin.top }}
              title={pin.title}
            >
              {label}
            </span>
          );
        }

        const open = openKey === pin.key;
        return (
          <div
            className={cn("pointer-events-auto", PIN_POSITION_CLASS)}
            data-canvas-comment-pin={pin.index}
            key={pin.key}
            style={{ left: pin.left, top: pin.top }}
          >
            <Popover
              onOpenChange={(next) => {
                setOpenKey(next ? pin.key : null);
                if (!next) {
                  setEditOnOpen(false);
                }
              }}
              open={open}
            >
              <PopoverTrigger asChild>
                <button
                  aria-label={pin.title}
                  className={cn(
                    PIN_BUTTON_CLASS,
                    open && "ring-action-accent/50"
                  )}
                  title={pin.title}
                  type="button"
                >
                  {label}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-72 gap-2 p-3"
                collisionPadding={12}
                side="bottom"
                sideOffset={6}
              >
                {pin.threads.length > 0 ? (
                  pin.threads.map((thread) => (
                    <InlineReviewThreadCard
                      chrome="plain"
                      handlers={props.handlers}
                      initialEditing={editOnOpen}
                      key={`${thread.threadId}-${editOnOpen ? editEpoch : "v"}`}
                      labels={props.labels}
                      thread={thread}
                    />
                  ))
                ) : (
                  <p className="text-muted-foreground text-xs">{pin.title}</p>
                )}
              </PopoverContent>
            </Popover>
          </div>
        );
      })}
    </>
  );
}
