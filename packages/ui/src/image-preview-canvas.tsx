import { ImageOff } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
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
} from "./empty.tsx";
import {
  anchoredScrollAfterZoom,
  centeredScroll,
  clampZoom,
  KEYBOARD_PAN_STEP_PX,
  measureContainScale,
  PAN_CLICK_SLOP_PX,
  ZOOM_FACTOR,
} from "./image-preview-canvas-math.ts";
import {
  type ImagePreviewCanvasLabels,
  ImagePreviewControls,
} from "./image-preview-controls.tsx";
import { Skeleton } from "./skeleton.tsx";
import { cn } from "./utils.ts";

export {
  anchoredScrollAfterZoom,
  centeredScroll,
  measureContainScale,
} from "./image-preview-canvas-math.ts";
export type { ImagePreviewCanvasLabels } from "./image-preview-controls.tsx";

export interface ImagePreviewCanvasProps {
  alt: string;
  className?: string;
  labels: ImagePreviewCanvasLabels;
  /** When true, show the loading skeleton overlay (src may already be set). */
  loading?: boolean;
  /** Fired when the empty viewport chrome is clicked (not the image). */
  onEmptyClick?: () => void;
  onError?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  src: string | null;
  /** Force the empty/error empty-state even when src is set. */
  status?: "error" | "loading" | "ready";
}

interface PanSession {
  fromEmpty: boolean;
  moved: boolean;
  originScrollLeft: number;
  originScrollTop: number;
  pointerId: number;
  startX: number;
  startY: number;
}

/**
 * Presentational zoomable image canvas.
 *
 * Fit and absolute zoom share one CSS `zoom` layout so switching presets does
 * not jump layout modes. Scroll is re-anchored to the viewport center on zoom
 * changes. When zoomed past fit, navigation is map-style pan (drag / wheel /
 * arrows) with system scrollbars hidden.
 */
export function ImagePreviewCanvas({
  alt,
  className,
  labels,
  loading = false,
  onEmptyClick,
  onError,
  onLoad,
  src,
  status,
}: ImagePreviewCanvasProps) {
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [fitScale, setFitScale] = useState(1);
  const [layoutReady, setLayoutReady] = useState(false);
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef<HTMLElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const panSessionRef = useRef<PanSession | null>(null);
  const prevEffectiveZoomRef = useRef<number | null>(null);
  let resolvedStatus: "error" | "loading" | "ready";
  if (status) {
    resolvedStatus = status;
  } else if (loading || !src) {
    resolvedStatus = "loading";
  } else {
    resolvedStatus = "ready";
  }

  const effectiveZoom = zoom === "fit" ? fitScale : zoom;
  // Absolute zoom mode enables grab-pan; fit mode is contained.
  const canPan = zoom !== "fit";

  const measureFit = useCallback(() => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!(viewport && image && image.naturalWidth > 0)) return;
    setFitScale(
      measureContainScale({
        naturalHeight: image.naturalHeight,
        naturalWidth: image.naturalWidth,
        viewportHeight: viewport.clientHeight,
        viewportWidth: viewport.clientWidth,
      })
    );
    setLayoutReady(true);
  }, []);

  const adjustZoom = useCallback(
    (direction: 1 | -1) => {
      setZoom((current) => {
        const base = current === "fit" ? fitScale : current;
        return clampZoom(
          direction > 0 ? base * ZOOM_FACTOR : base / ZOOM_FACTOR
        );
      });
    },
    [fitScale]
  );
  const toggleZoom = useCallback(() => {
    setZoom((current) => (current === "fit" ? 1 : "fit"));
  }, []);

  useEffect(() => {
    // Keyed on src: reset fit measurement and scroll anchor for a new image.
    if (src === null) {
      prevEffectiveZoomRef.current = null;
      setLayoutReady(false);
      setFitScale(1);
      return;
    }
    prevEffectiveZoomRef.current = null;
    setLayoutReady(false);
    setFitScale(1);
  }, [src]);

  useLayoutEffect(() => {
    measureFit();
  }, [measureFit]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      measureFit();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [measureFit]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!(viewport && layoutReady) || resolvedStatus === "error") return;
    const previous = prevEffectiveZoomRef.current;
    if (previous === effectiveZoom) return;
    prevEffectiveZoomRef.current = effectiveZoom;

    const overflows =
      viewport.scrollWidth > viewport.clientWidth + 1 ||
      viewport.scrollHeight > viewport.clientHeight + 1;

    // Fit / first layout / undersized: rely on flex + margin:auto centering.
    // Clear leftover scroll so auto margins can take effect.
    if (previous === null || zoom === "fit" || !overflows) {
      if (overflows) {
        const centered = centeredScroll(viewport);
        viewport.scrollLeft = centered.scrollLeft;
        viewport.scrollTop = centered.scrollTop;
      } else {
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;
      }
      return;
    }

    const next = anchoredScrollAfterZoom({
      clientHeight: viewport.clientHeight,
      clientWidth: viewport.clientWidth,
      newZoom: effectiveZoom,
      oldZoom: previous,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    });
    viewport.scrollLeft = next.scrollLeft;
    viewport.scrollTop = next.scrollTop;
  }, [effectiveZoom, layoutReady, resolvedStatus, zoom]);

  useEffect(
    () => () => {
      panSessionRef.current = null;
    },
    []
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        adjustZoom(1);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        adjustZoom(-1);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
        return;
      }
      if (!canPan) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const step = event.shiftKey
        ? KEYBOARD_PAN_STEP_PX * 3
        : KEYBOARD_PAN_STEP_PX;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        viewport.scrollLeft -= step;
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        viewport.scrollLeft += step;
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        viewport.scrollTop -= step;
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        viewport.scrollTop += step;
      }
    },
    [adjustZoom, canPan]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const fromEmpty = event.target === event.currentTarget;
      if (!(canPan || fromEmpty)) return;
      panSessionRef.current = {
        fromEmpty,
        moved: false,
        originScrollLeft: viewport.scrollLeft,
        originScrollTop: viewport.scrollTop,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      if (typeof viewport.setPointerCapture === "function") {
        viewport.setPointerCapture(event.pointerId);
      }
      if (canPan) {
        setPanning(true);
      }
    },
    [canPan]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = panSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;
      if (
        !session.moved &&
        (Math.abs(dx) >= PAN_CLICK_SLOP_PX || Math.abs(dy) >= PAN_CLICK_SLOP_PX)
      ) {
        session.moved = true;
      }
      if (!(canPan && session.moved)) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      event.preventDefault();
      viewport.scrollLeft = session.originScrollLeft - dx;
      viewport.scrollTop = session.originScrollTop - dy;
    },
    [canPan]
  );

  const endPanSession = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = panSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      panSessionRef.current = null;
      setPanning(false);
      if (
        typeof event.currentTarget.hasPointerCapture === "function" &&
        event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!session.moved && session.fromEmpty) {
        onEmptyClick?.();
      }
    },
    [onEmptyClick]
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      if (event.deltaY === 0) return;
      adjustZoom(event.deltaY < 0 ? 1 : -1);
    },
    [adjustZoom]
  );

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      measureFit();
      onLoad?.(event);
    },
    [measureFit, onLoad]
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
      if (event.button !== 0) return;
      if (event.target !== event.currentTarget) return;
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
          canPan && (panning ? "cursor-grabbing" : "cursor-grab"),
          panning && "select-none"
        )}
        data-scrollbar="none"
        data-slot="image-preview-viewport"
        onDoubleClick={toggleZoom}
        onKeyDown={handleKeyDown}
        onPointerCancel={endPanSession}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPanSession}
        onWheel={handleWheel}
        ref={viewportRef}
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
            zoom: effectiveZoom,
          }}
          width={1}
        />
      </section>

      <ImagePreviewControls
        effectiveZoom={effectiveZoom}
        labels={labels}
        onZoomChange={setZoom}
        onZoomIn={() => adjustZoom(1)}
        onZoomOut={() => adjustZoom(-1)}
        zoom={zoom}
      />
    </div>
  );
}
