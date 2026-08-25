import { ImageOff } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  useCallback,
  useRef,
} from "react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../empty.tsx";
import { Skeleton } from "../skeleton.tsx";
import { cn } from "../utils.ts";
import {
  type ImagePreviewCanvasLabels,
  ImagePreviewControls,
} from "./controls.tsx";
import { useZoomPanViewport } from "./use-zoom-pan-viewport.ts";

export {
  anchoredScrollAfterZoom,
  centeredScroll,
  measureContainScale,
} from "./canvas-math.ts";
export type { ImagePreviewCanvasLabels } from "./controls.tsx";

export interface ImagePreviewCanvasProps {
  alt: string;
  className?: string;
  labels: ImagePreviewCanvasLabels;
  /** When true, show the loading skeleton overlay (src may already be set). */
  loading?: boolean;
  /** When provided (with `labels.copyImage`), shows a copy-image toolbar button. */
  onCopyImage?: () => Promise<void>;
  /** Fired when the empty viewport chrome is clicked (not the image). */
  onEmptyClick?: () => void;
  onError?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  src: string | null;
  /** Force the empty/error empty-state even when src is set. */
  status?: "error" | "loading" | "ready";
}

/**
 * Presentational zoomable image canvas.
 *
 * Fit and absolute zoom share one CSS `zoom` layout so switching presets does
 * not jump layout modes. Scroll is re-anchored to the viewport center on zoom
 * changes. Wheel (and Ctrl/Cmd+wheel) always zoom; when zoomed past fit,
 * navigation is map-style pan (drag / arrows) with system scrollbars hidden.
 */
export function ImagePreviewCanvas({
  alt,
  className,
  labels,
  loading = false,
  onCopyImage,
  onEmptyClick,
  onError,
  onLoad,
  src,
  status,
}: ImagePreviewCanvasProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  let resolvedStatus: "error" | "loading" | "ready";
  if (status) {
    resolvedStatus = status;
  } else if (loading || !src) {
    resolvedStatus = "loading";
  } else {
    resolvedStatus = "ready";
  }
  const ready = Boolean(src) && resolvedStatus !== "error";

  const getNaturalSize = useCallback(() => {
    const image = imageRef.current;
    if (!(image && image.naturalWidth > 0)) {
      return null;
    }
    return { height: image.naturalHeight, width: image.naturalWidth };
  }, []);

  const pan = useZoomPanViewport({
    enabled: ready,
    getNaturalSize,
    resetKey: src,
  });

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      pan.measureFit();
      onLoad?.(event);
    },
    [onLoad, pan.measureFit]
  );

  const loadingIndicator =
    resolvedStatus === "loading" ? (
      <div
        className="absolute inset-3 flex items-center justify-center"
        role="status"
      >
        <span className="sr-only">{labels.loading}</span>
        <Skeleton className="h-2/3 w-2/3 max-w-2xl" />
      </div>
    ) : null;

  const dismissOnEmptyPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      if (event.target !== event.currentTarget) {
        return;
      }
      onEmptyClick?.();
    },
    [onEmptyClick]
  );

  if (resolvedStatus === "loading" && !src) {
    return (
      <section
        aria-busy="true"
        aria-label={labels.viewerLabel}
        className={cn(
          "relative flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-3",
          className
        )}
        onPointerUp={dismissOnEmptyPointerUp}
      >
        {loadingIndicator}
      </section>
    );
  }

  if (!(src && resolvedStatus !== "error")) {
    return (
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center",
          className
        )}
        onPointerUp={dismissOnEmptyPointerUp}
      >
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ImageOff />
            </EmptyMedia>
            <EmptyTitle>{labels.loadFailedTitle}</EmptyTitle>
            <EmptyDescription>{labels.loadFailedDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const showLoading = resolvedStatus === "loading";

  return (
    <div className={cn("relative min-h-0 flex-1 bg-background", className)}>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: focusable canvas exposes zoom/pan shortcuts */}
      <section
        aria-busy={showLoading}
        aria-label={labels.viewerLabel}
        className={cn(
          "absolute inset-0 flex overflow-auto bg-background p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset",
          pan.canPan && (pan.panning ? "cursor-grabbing" : "cursor-grab"),
          pan.panning && "select-none"
        )}
        data-scrollbar="none"
        data-slot="image-preview-viewport"
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
        {loadingIndicator}
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: load failures are scoped to the preview URL */}
        <img
          alt={alt}
          className={cn("m-auto max-w-none", showLoading && "opacity-0")}
          draggable={false}
          height={1}
          onError={onError}
          onLoad={handleImageLoad}
          ref={imageRef}
          src={src}
          style={{
            height: "auto",
            width: "auto",
            zoom: pan.effectiveZoom,
          }}
          width={1}
        />
      </section>

      <ImagePreviewControls
        effectiveZoom={pan.effectiveZoom}
        labels={labels}
        onZoomChange={pan.setZoom}
        onZoomIn={() => pan.adjustZoom(1)}
        onZoomOut={() => pan.adjustZoom(-1)}
        zoom={pan.zoom}
        {...(onCopyImage ? { onCopyImage } : {})}
      />
    </div>
  );
}
