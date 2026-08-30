import { ImageOff } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
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

function corsAttrsForSrc(
  src: string
): { crossOrigin: "anonymous" } | Record<string, never> {
  if (src.startsWith("data:") || src.startsWith("blob:")) {
    return {};
  }
  return { crossOrigin: "anonymous" };
}

export interface ImagePreviewCanvasProps {
  alt: string;
  className?: string;
  labels: ImagePreviewCanvasLabels;
  /** Pulse skeleton only when there is no src to paint. */
  loading?: boolean;
  /** When provided (with `labels.copyImage`), shows a copy-image toolbar button. */
  onCopyImage?: (image: HTMLImageElement) => Promise<void>;
  /** Fired when the empty viewport chrome is clicked (not the image). */
  onEmptyClick?: () => void;
  onError?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  /** Replacement src failed; the live frame is still painted. */
  onPendingError?: (event: SyntheticEvent<HTMLImageElement>) => void;
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
 *
 * Keep the live src painted until a replacement decodes. Do not overlay
 * Skeleton while any src is on the canvas.
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
  onPendingError,
  src,
  status,
}: ImagePreviewCanvasProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [visibleSrc, setVisibleSrc] = useState<string | null>(src);
  const [decoded, setDecoded] = useState(false);
  let resolvedStatus: "error" | "loading" | "ready";
  if (status) {
    resolvedStatus = status;
  } else if (loading || !src) {
    resolvedStatus = "loading";
  } else {
    resolvedStatus = "ready";
  }
  const displaySrc = visibleSrc ?? src;
  const pendingSrc = src && visibleSrc && src !== visibleSrc ? src : null;
  const ready = Boolean(displaySrc) && resolvedStatus !== "error";

  useLayoutEffect(() => {
    if (!src) {
      setVisibleSrc(null);
      return;
    }
    if (!visibleSrc) {
      setVisibleSrc(src);
    }
  }, [src, visibleSrc]);

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
    resetKey: displaySrc,
  });

  const markDecoded = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      setDecoded(true);
      pan.measureFit();
      onLoad?.(event);
    },
    [onLoad, pan.measureFit]
  );

  const handleLiveLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      markDecoded(event);
    },
    [markDecoded]
  );

  const handlePendingLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const loadedSrc = event.currentTarget.getAttribute("src");
      if (loadedSrc) {
        setVisibleSrc(loadedSrc);
      }
      markDecoded(event);
    },
    [markDecoded]
  );

  const handleLiveError = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      if (pendingSrc) {
        return;
      }
      onError?.(event);
    },
    [onError, pendingSrc]
  );

  const handlePendingError = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      onPendingError?.(event);
    },
    [onPendingError]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check decode when the painted src identity changes
  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!(image?.complete && image.naturalWidth > 0)) {
      return;
    }
    setDecoded(true);
    pan.measureFit();
  }, [displaySrc, pan.measureFit]);

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

  if (resolvedStatus === "loading" && !displaySrc) {
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
        <div
          className="absolute inset-3 flex items-center justify-center"
          role="status"
        >
          <span className="sr-only">{labels.loading}</span>
          <Skeleton className="h-2/3 w-2/3 max-w-2xl" />
        </div>
      </section>
    );
  }

  if (!(displaySrc && resolvedStatus !== "error")) {
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

  const hideUntilFit = !(pan.layoutReady || decoded);
  const canCopy = Boolean(onCopyImage && decoded);

  return (
    <div className={cn("relative min-h-0 flex-1 bg-background", className)}>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: focusable canvas exposes zoom/pan shortcuts */}
      <section
        aria-busy={resolvedStatus === "loading"}
        aria-label={labels.viewerLabel}
        className={cn(
          // pb-16 reserves the bottom band for the floating zoom pill
          // (VIEWPORT_CONTROLS_INSET_PX) so content never rests under it.
          "absolute inset-0 flex overflow-auto bg-background p-3 pb-16 outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset",
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
        {pendingSrc ? (
          // biome-ignore lint/a11y/noNoninteractiveElementInteractions: load failures are scoped to the preview URL
          <img
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute m-auto max-w-none opacity-0"
            data-slot="image-preview-pending"
            draggable={false}
            height={1}
            onError={handlePendingError}
            onLoad={handlePendingLoad}
            {...corsAttrsForSrc(pendingSrc)}
            src={pendingSrc}
            style={{
              height: "auto",
              width: "auto",
              zoom: pan.effectiveZoom,
            }}
            width={1}
          />
        ) : null}
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: load failures are scoped to the preview URL */}
        <img
          alt={alt}
          className={cn("m-auto max-w-none", hideUntilFit && "opacity-0")}
          draggable={false}
          height={1}
          onError={handleLiveError}
          onLoad={handleLiveLoad}
          ref={imageRef}
          {...corsAttrsForSrc(displaySrc)}
          src={displaySrc}
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
        {...(canCopy && onCopyImage
          ? {
              onCopyImage: async () => {
                const image = imageRef.current;
                if (!image) {
                  return;
                }
                await onCopyImage(image);
              },
            }
          : {})}
      />
    </div>
  );
}
