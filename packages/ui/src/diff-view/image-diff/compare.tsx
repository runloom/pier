import { ChevronsLeftRight } from "lucide-react";
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  RefObject,
} from "react";
import { useEffect, useRef, useState } from "react";
import {
  CONTROL_ICON_GLYPH_COMPACT_CLASS,
  CONTROL_ICON_HIT_COMPACT_CLASS,
} from "../../interactive-density.ts";
import { Slider } from "../../slider.tsx";
import { cn } from "../../utils.ts";
import {
  accentBorder,
  accentColor,
  IMAGE_DIFF_CHECKER_SLOT,
  IMAGE_DIFF_STAGE_CLASS,
  ImageDiffSideCaptions,
  StagedImage,
  stageFrameStyle,
} from "./frame.tsx";
import type { ImageDiffStage } from "./stage.ts";
import type { PierImageDiffLabels, PierImageDiffSide } from "./types.ts";

const SWIPE_CAPTION_HIDE_PCT = 12;
const SWIPE_DOUBLE_TAP_MS = 500;
const SWIPE_TAP_SLOP_PX = 4;
const SWIPE_DOUBLE_TAP_SLOP_PX = 8;
const SWIPE_PAGE_STEP = 10;
const SWIPE_ARROW_STEP = 5;
const SWIPE_ARROW_SHIFT_STEP = 10;

export function SwipeImageDiff({
  afterUrl,
  beforeUrl,
  labels,
  locale,
  stage,
}: {
  readonly after: PierImageDiffSide;
  readonly afterUrl: string | null;
  readonly before: PierImageDiffSide;
  readonly beforeUrl: string | null;
  readonly labels: PierImageDiffLabels;
  readonly locale: string;
  readonly stage: ImageDiffStage | null;
}): React.JSX.Element {
  const lastTapRef = useRef<{ at: number; x: number } | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [percent, setPercent] = useState(50);
  useSwipeDragChrome(dragging, () => {
    setDragging(false);
  });
  const setFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const next = ((event.clientX - rect.left) / rect.width) * 100;
    setPercent(Math.min(100, Math.max(0, next)));
  };
  const stopDragging = () => {
    setDragging(false);
  };
  return (
    <div className="flex w-full min-w-0 flex-col items-center px-3 pt-4 pb-5">
      <div className="relative max-w-full" style={stageFrameStyle(stage)}>
        <div
          aria-label={labels.swipe}
          aria-orientation="horizontal"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(percent)}
          aria-valuetext={swipeValueText(percent, locale)}
          className="group/swipe absolute inset-0 cursor-col-resize touch-none outline-none"
          data-dragging={dragging ? "true" : undefined}
          onKeyDown={(event) => handleSliderKey(event, setPercent)}
          onLostPointerCapture={() => {
            pointerDownRef.current = null;
            stopDragging();
          }}
          onPointerCancel={() => {
            pointerDownRef.current = null;
            stopDragging();
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.preventDefault();
            pointerDownRef.current = { x: event.clientX, y: event.clientY };
            capturePointer(event.currentTarget, event.pointerId);
            setDragging(true);
            setFromPointer(event);
            event.currentTarget.focus({ preventScroll: true });
          }}
          onPointerMove={(event) => {
            if (hasCapturedPointer(event.currentTarget, event.pointerId)) {
              setFromPointer(event);
            }
          }}
          onPointerUp={(event) => {
            stopDragging();
            applySwipeDoubleTap(event, pointerDownRef, lastTapRef, setPercent);
          }}
          role="slider"
          style={swipeVarStyle(percent)}
          tabIndex={0}
        >
          <div
            aria-hidden="true"
            className={cn(
              IMAGE_DIFF_STAGE_CLASS,
              "absolute inset-0 rounded-md border border-border"
            )}
            data-slot="pier-image-diff-stage"
          >
            <div
              className="absolute inset-0"
              data-slot={IMAGE_DIFF_CHECKER_SLOT}
            >
              <StagedImage
                box={stage?.after ?? null}
                labels={labels}
                pixelated={stage?.pixelated ?? false}
                stage={stage}
                url={afterUrl}
              />
            </div>
            <div
              className="absolute inset-0 overflow-hidden"
              data-slot={IMAGE_DIFF_CHECKER_SLOT}
              style={{
                clipPath:
                  "inset(0 calc(100% - var(--pier-image-diff-swipe)) 0 0)",
              }}
            >
              <StagedImage
                box={stage?.before ?? null}
                labels={labels}
                pixelated={stage?.pixelated ?? false}
                stage={stage}
                url={beforeUrl}
              />
            </div>
          </div>
          <SwipeBar />
        </div>
        <SwipeOverlayCaptions labels={labels} percent={percent} />
      </div>
    </div>
  );
}

export function OnionImageDiff({
  afterUrl,
  beforeUrl,
  labels,
  stage,
}: {
  readonly after: PierImageDiffSide;
  readonly afterUrl: string | null;
  readonly before: PierImageDiffSide;
  readonly beforeUrl: string | null;
  readonly labels: PierImageDiffLabels;
  readonly locale: string;
  readonly stage: ImageDiffStage | null;
}): React.JSX.Element {
  const [percent, setPercent] = useState(50);
  return (
    <div className="flex w-full min-w-0 flex-col items-center gap-3 px-3 py-3">
      <ImageDiffSideCaptions labels={labels} />
      <div
        className={IMAGE_DIFF_STAGE_CLASS}
        data-slot="pier-image-diff-stage"
        style={stageFrameStyle(stage)}
      >
        <div
          className="absolute inset-0 border border-solid"
          style={accentBorder("deletion")}
        >
          <StagedImage
            box={stage?.before ?? null}
            labels={labels}
            pixelated={stage?.pixelated ?? false}
            stage={stage}
            url={beforeUrl}
          />
        </div>
        <div
          className="absolute inset-0 border border-solid"
          style={{ ...accentBorder("addition"), opacity: percent / 100 }}
        >
          <StagedImage
            box={stage?.after ?? null}
            labels={labels}
            pixelated={stage?.pixelated ?? false}
            stage={stage}
            url={afterUrl}
          />
        </div>
      </div>
      <Slider
        aria-label={labels.onionSkin}
        className="max-w-[18.75rem]"
        max={100}
        min={0}
        onValueChange={(value) => {
          const next = value[0];
          if (typeof next === "number") {
            setPercent(next);
          }
        }}
        value={[percent]}
      />
    </div>
  );
}

function SwipeBar(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="group/bar absolute inset-y-0 z-10 w-6 -translate-x-1/2"
      data-slot="pier-image-diff-swipe-bar"
      style={{ left: "var(--pier-image-diff-swipe)" }}
    >
      <span
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground transition-[width,background-color] duration-150 group-hover/bar:w-0.5 group-hover/bar:bg-action-accent group-focus-visible/swipe:w-0.5 group-data-[dragging]/swipe:w-0.5 group-data-[dragging]/swipe:bg-action-accent"
        data-slot="pier-image-diff-swipe-blade"
      />
      <span
        className={cn(
          CONTROL_ICON_HIT_COMPACT_CLASS,
          CONTROL_ICON_GLYPH_COMPACT_CLASS,
          "absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background not-dark:bg-clip-padding text-muted-foreground shadow-md ring-1 ring-foreground/10 transition-[color,box-shadow] duration-150 group-hover/bar:text-action-accent group-hover/bar:ring-2 group-hover/bar:ring-action-accent group-focus-visible/swipe:ring-4 group-focus-visible/swipe:ring-ring/30 group-data-[dragging]/swipe:text-action-accent group-data-[dragging]/swipe:ring-2 group-data-[dragging]/swipe:ring-action-accent"
        )}
        data-slot="pier-image-diff-swipe-grip"
      >
        <ChevronsLeftRight aria-hidden data-icon="grip" />
      </span>
    </div>
  );
}

function SwipeOverlayCaptions({
  labels,
  percent,
}: {
  readonly labels: PierImageDiffLabels;
  readonly percent: number;
}): React.JSX.Element {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-between gap-2 p-2"
      data-slot="pier-image-diff-swipe-captions"
    >
      <span
        className={cn(
          "rounded-md bg-background/80 px-1.5 py-0.5 font-medium text-xs backdrop-blur-sm transition-opacity",
          percent < SWIPE_CAPTION_HIDE_PCT && "opacity-0"
        )}
        data-slot="pier-image-diff-swipe-caption"
        style={accentColor("deletion")}
      >
        {labels.deleted}
      </span>
      <span
        className={cn(
          "rounded-md bg-background/80 px-1.5 py-0.5 font-medium text-xs backdrop-blur-sm transition-opacity",
          percent > 100 - SWIPE_CAPTION_HIDE_PCT && "opacity-0"
        )}
        data-slot="pier-image-diff-swipe-caption"
        style={accentColor("addition")}
      >
        {labels.added}
      </span>
    </div>
  );
}

function swipeVarStyle(percent: number): CSSProperties & {
  "--pier-image-diff-swipe": string;
} {
  return {
    "--pier-image-diff-swipe": `${String(percent)}%`,
  };
}

function swipeValueText(percent: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    style: "percent",
  }).format(percent / 100);
}

function useSwipeDragChrome(dragging: boolean, onInterrupt: () => void): void {
  const onInterruptRef = useRef(onInterrupt);
  onInterruptRef.current = onInterrupt;
  useEffect(() => {
    if (!dragging) {
      return;
    }
    const root = document.documentElement;
    const cursor = root.style.cursor;
    const userSelect = root.style.userSelect;
    root.style.cursor = "col-resize";
    root.style.userSelect = "none";
    const interrupt = () => {
      onInterruptRef.current();
    };
    const onVisibility = () => {
      if (document.hidden) {
        interrupt();
      }
    };
    window.addEventListener("blur", interrupt);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      root.style.cursor = cursor;
      root.style.userSelect = userSelect;
      window.removeEventListener("blur", interrupt);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [dragging]);
}

function applySwipeDoubleTap(
  event: PointerEvent<HTMLDivElement>,
  pointerDownRef: RefObject<{ x: number; y: number } | null>,
  lastTapRef: RefObject<{ at: number; x: number } | null>,
  setPercent: (percent: number) => void
): void {
  const down = pointerDownRef.current;
  pointerDownRef.current = null;
  if (down === null || event.button !== 0) {
    return;
  }
  const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
  if (moved > SWIPE_TAP_SLOP_PX) {
    lastTapRef.current = null;
    return;
  }
  const prev = lastTapRef.current;
  if (
    prev !== null &&
    event.timeStamp - prev.at <= SWIPE_DOUBLE_TAP_MS &&
    Math.abs(event.clientX - prev.x) <= SWIPE_DOUBLE_TAP_SLOP_PX
  ) {
    setPercent(50);
    lastTapRef.current = null;
    return;
  }
  lastTapRef.current = { at: event.timeStamp, x: event.clientX };
}

function capturePointer(target: HTMLElement, pointerId: number): void {
  if (typeof target.setPointerCapture === "function") {
    target.setPointerCapture(pointerId);
  }
}

function hasCapturedPointer(target: HTMLElement, pointerId: number): boolean {
  return typeof target.hasPointerCapture === "function"
    ? target.hasPointerCapture(pointerId)
    : false;
}

function handleSliderKey(
  event: KeyboardEvent<HTMLDivElement>,
  setPercent: (updater: (current: number) => number) => void
): void {
  if (event.key === "Home") {
    event.preventDefault();
    setPercent(() => 0);
    return;
  }
  if (event.key === "End") {
    event.preventDefault();
    setPercent(() => 100);
    return;
  }
  if (event.key === "PageDown") {
    event.preventDefault();
    setPercent((current) => Math.max(0, current - SWIPE_PAGE_STEP));
    return;
  }
  if (event.key === "PageUp") {
    event.preventDefault();
    setPercent((current) => Math.min(100, current + SWIPE_PAGE_STEP));
    return;
  }
  const step = event.shiftKey ? SWIPE_ARROW_SHIFT_STEP : SWIPE_ARROW_STEP;
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
    event.preventDefault();
    setPercent((current) => Math.max(0, current - step));
    return;
  }
  if (event.key === "ArrowRight" || event.key === "ArrowUp") {
    event.preventDefault();
    setPercent((current) => Math.min(100, current + step));
  }
}
