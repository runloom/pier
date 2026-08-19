import { ChevronsLeftRight } from "lucide-react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useState } from "react";
import {
  CONTROL_ICON_GLYPH_CLASS,
  CONTROL_ICON_SIZE_CLASS,
} from "../../interactive-density.ts";
import { Slider } from "../../slider.tsx";
import { cn } from "../../utils.ts";
import {
  accentBorder,
  IMAGE_DIFF_CHECKER_SLOT,
  IMAGE_DIFF_STAGE_CLASS,
  ImageDiffSideCaptions,
  StagedImage,
  stageFrameStyle,
} from "./frame.tsx";
import type { ImageDiffStage } from "./stage.ts";
import type { PierImageDiffLabels, PierImageDiffSide } from "./types.ts";

export function SwipeImageDiff({
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
  const [dragging, setDragging] = useState(false);
  const [percent, setPercent] = useState(50);
  const setFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const next = ((event.clientX - rect.left) / rect.width) * 100;
    setPercent(Math.min(100, Math.max(0, next)));
  };
  return (
    <div className="flex w-full min-w-0 flex-col items-center gap-2 px-3 pt-4 pb-5">
      <ImageDiffSideCaptions labels={labels} />
      <div
        className="group/swipe relative max-w-full cursor-col-resize touch-none"
        data-dragging={dragging ? "true" : undefined}
        onPointerCancel={() => {
          setDragging(false);
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          setFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            setFromPointer(event);
          }
        }}
        onPointerUp={() => {
          setDragging(false);
        }}
        style={stageFrameStyle(stage)}
      >
        <div
          className={cn(IMAGE_DIFF_STAGE_CLASS, "absolute inset-0")}
          data-slot="pier-image-diff-stage"
        >
          <div
            className="absolute inset-0 border border-solid"
            data-slot={IMAGE_DIFF_CHECKER_SLOT}
            style={accentBorder("addition")}
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
            className="absolute inset-0 overflow-hidden border border-solid"
            data-slot={IMAGE_DIFF_CHECKER_SLOT}
            style={{
              ...accentBorder("deletion"),
              clipPath: `inset(0 ${String(100 - percent)}% 0 0)`,
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
        <SwipeBar
          label={labels.swipe}
          percent={percent}
          setPercent={setPercent}
        />
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

function SwipeBar({
  label,
  percent,
  setPercent,
}: {
  readonly label: string;
  readonly percent: number;
  readonly setPercent: (updater: (current: number) => number) => void;
}): React.JSX.Element {
  return (
    <div
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(percent)}
      className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-col-resize outline-none focus-visible:ring-4 focus-visible:ring-ring/30"
      data-slot="pier-image-diff-swipe-bar"
      onKeyDown={(event) => handleSliderKey(event, setPercent)}
      role="slider"
      style={{ left: `${String(percent)}%` }}
      tabIndex={0}
    >
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-background" />
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-foreground transition-[width] group-hover/swipe:w-1 group-data-[dragging]/swipe:w-1" />
      <span
        className={cn(
          CONTROL_ICON_SIZE_CLASS,
          CONTROL_ICON_GLYPH_CLASS,
          "pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-foreground bg-background text-foreground shadow-sm transition-transform group-hover/swipe:scale-110 group-data-[dragging]/swipe:scale-110"
        )}
        data-slot="pier-image-diff-swipe-grip"
      >
        <ChevronsLeftRight aria-hidden data-icon="grip" />
      </span>
    </div>
  );
}

function handleSliderKey(
  event: KeyboardEvent<HTMLDivElement>,
  setPercent: (updater: (current: number) => number) => void
): void {
  const step = event.shiftKey ? 10 : 5;
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
