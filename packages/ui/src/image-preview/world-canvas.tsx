import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../utils.ts";
import { measureContainScale } from "./canvas-math.ts";
import {
  type ImagePreviewCanvasLabels,
  ImagePreviewControls,
} from "./controls.tsx";
import { MediaFullscreenButton } from "./media-fullscreen-button.tsx";
import { useZoomPanViewport } from "./use-zoom-pan-viewport.ts";

const INTERACTIVE_PAN_IGNORE =
  "button, a, input, textarea, select, [role='tab'], [data-no-drag]";

function worldNaturalSize(
  world: HTMLElement | null
): { height: number; width: number } | null {
  if (!world) {
    return null;
  }
  const width = world.offsetWidth;
  const height = world.offsetHeight;
  if (!(width > 0 && height > 0)) {
    return null;
  }
  return { height, width };
}

function FitWorldCard({
  children,
  className,
  expandLabel,
  expandable,
  onOpenFullscreen,
  viewerLabel,
}: {
  children: ReactNode;
  className?: string;
  expandLabel: string;
  expandable: boolean;
  onOpenFullscreen?: () => void;
  viewerLabel: string;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const [fitScale, setFitScale] = useState(1);

  const measureFit = useCallback(() => {
    const viewport = viewportRef.current;
    const natural = worldNaturalSize(worldRef.current);
    if (!(viewport && natural)) {
      return;
    }
    setFitScale(
      measureContainScale({
        naturalHeight: natural.height,
        naturalWidth: natural.width,
        viewportHeight: viewport.clientHeight,
        viewportWidth: viewport.clientWidth,
      })
    );
  }, []);

  useLayoutEffect(() => {
    measureFit();
  }, [measureFit]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const world = worldRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      measureFit();
    });
    observer.observe(viewport);
    if (world) {
      observer.observe(world);
    }
    return () => observer.disconnect();
  }, [measureFit]);

  return (
    <section
      aria-label={viewerLabel}
      className={cn(
        "group relative h-[min(32rem,55vh)] min-h-80 overflow-hidden rounded-lg border bg-muted/20",
        className
      )}
      data-slot="html-world-card"
    >
      <div
        className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden p-3"
        data-slot="html-world-viewport"
        ref={viewportRef}
      >
        <div
          className="max-w-none"
          data-slot="html-world-zoom"
          style={{ zoom: fitScale }}
        >
          <div data-slot="html-world" ref={worldRef}>
            {children}
          </div>
        </div>
      </div>
      {onOpenFullscreen && expandable ? (
        <MediaFullscreenButton label={expandLabel} onClick={onOpenFullscreen} />
      ) : null}
    </section>
  );
}

function ZoomPanWorldStage({
  children,
  className,
  expandLabel,
  expandable,
  labels,
  onEmptyClick,
  onOpenFullscreen,
}: {
  children: ReactNode;
  className?: string;
  expandLabel: string;
  expandable: boolean;
  labels: ImagePreviewCanvasLabels;
  onEmptyClick?: () => void;
  onOpenFullscreen?: () => void;
}) {
  const worldRef = useRef<HTMLDivElement | null>(null);
  const getNaturalSize = useCallback(
    () => worldNaturalSize(worldRef.current),
    []
  );
  const shouldCapturePointer = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return true;
      }
      return !target.closest(INTERACTIVE_PAN_IGNORE);
    },
    []
  );
  const pan = useZoomPanViewport({
    getNaturalSize,
    shouldCapturePointer,
  });

  useEffect(() => {
    const world = worldRef.current;
    if (!world || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      pan.measureFit();
    });
    observer.observe(world);
    return () => observer.disconnect();
  }, [pan.measureFit]);

  return (
    <div
      className={cn("group relative min-h-0 flex-1 bg-background", className)}
    >
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: focusable canvas exposes zoom/pan shortcuts */}
      <section
        aria-label={labels.viewerLabel}
        className={cn(
          "absolute inset-0 flex overflow-auto bg-background p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset",
          pan.canPan && (pan.panning ? "cursor-grabbing" : "cursor-grab"),
          pan.panning && "select-none"
        )}
        data-scrollbar="none"
        data-slot="html-world-viewport"
        onDoubleClick={pan.toggleZoom}
        onKeyDown={pan.handleKeyDown}
        onPointerCancel={(event) => pan.endPanSession(event, onEmptyClick)}
        onPointerDown={pan.handlePointerDown}
        onPointerMove={pan.handlePointerMove}
        onPointerUp={(event) => pan.endPanSession(event, onEmptyClick)}
        onWheel={pan.handleWheel}
        ref={pan.viewportRef}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: canvas accepts zoom/pan shortcuts when focused
        tabIndex={0}
      >
        <div
          className="m-auto max-w-none"
          data-slot="html-world-zoom"
          style={{ zoom: pan.effectiveZoom }}
        >
          <div data-slot="html-world" ref={worldRef}>
            {children}
          </div>
        </div>
      </section>
      {onOpenFullscreen && expandable ? (
        <MediaFullscreenButton label={expandLabel} onClick={onOpenFullscreen} />
      ) : null}
      <ImagePreviewControls
        effectiveZoom={pan.effectiveZoom}
        labels={labels}
        onZoomChange={pan.setZoom}
        onZoomIn={() => pan.adjustZoom(1)}
        onZoomOut={() => pan.adjustZoom(-1)}
        zoom={pan.zoom}
      />
    </div>
  );
}

/**
 * HTML world on the same zoom/pan stage as image / mermaid preview.
 *
 * `card` — static fit-all snapshot (does not capture wheel / page scroll).
 * `stage` — fullscreen preview: fit by default, wheel/buttons zoom, drag pan.
 */
export function HtmlWorldCanvas({
  children,
  className,
  expandLabel = "View fullscreen",
  expandable = true,
  labels,
  onEmptyClick,
  onOpenFullscreen,
  presentation = "card",
  viewerLabel,
}: {
  children: ReactNode;
  className?: string;
  expandLabel?: string;
  expandable?: boolean;
  labels?: ImagePreviewCanvasLabels;
  onEmptyClick?: () => void;
  onOpenFullscreen?: () => void;
  presentation?: "card" | "stage";
  viewerLabel: string;
}) {
  if (presentation === "stage") {
    if (!labels) {
      throw new Error("HtmlWorldCanvas stage requires zoom-control labels");
    }
    return (
      <ZoomPanWorldStage
        expandable={expandable}
        expandLabel={expandLabel}
        labels={{ ...labels, viewerLabel }}
        {...(className ? { className } : {})}
        {...(onEmptyClick ? { onEmptyClick } : {})}
        {...(onOpenFullscreen ? { onOpenFullscreen } : {})}
      >
        {children}
      </ZoomPanWorldStage>
    );
  }
  return (
    <FitWorldCard
      expandable={expandable}
      expandLabel={expandLabel}
      viewerLabel={viewerLabel}
      {...(className ? { className } : {})}
      {...(onOpenFullscreen ? { onOpenFullscreen } : {})}
    >
      {children}
    </FitWorldCard>
  );
}
