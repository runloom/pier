import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../utils.ts";
import {
  measureContainScale,
  measureWorldContentBounds,
  type WorldCamera,
} from "./canvas-math.ts";
import {
  type ImagePreviewCanvasLabels,
  ImagePreviewControls,
} from "./controls.tsx";
import { MediaFullscreenButton } from "./media-fullscreen-button.tsx";
import { useWorldCamera, type WorldCameraApi } from "./use-world-camera.ts";

/** Shared pan-capture ignore list — canvas world stage imports this too. */
export const INTERACTIVE_PAN_IGNORE =
  "button, a, input, textarea, select, [role='tab'], [data-no-drag]";

function resolveViewportCursor(camera: WorldCameraApi): string {
  if (camera.panning) {
    return "cursor-grabbing";
  }
  if (camera.spacePressed) {
    return "cursor-grab";
  }
  return "cursor-default";
}

function computeDotGridStyle(
  active: boolean,
  camera: WorldCamera | null
): CSSProperties | undefined {
  if (!(active && camera)) {
    return;
  }
  const spacing = 20;
  const offsetX = ((camera.x % spacing) + spacing) % spacing;
  const offsetY = ((camera.y % spacing) + spacing) % spacing;
  return {
    backgroundImage:
      "radial-gradient(circle, var(--border) 1.25px, transparent 1.25px)",
    backgroundPosition: `${offsetX}px ${offsetY}px`,
    backgroundSize: `${spacing}px ${spacing}px`,
  };
}

/**
 * Single source for the world camera viewport chrome (section + camera box).
 * Both world shells consume it: `ZoomPanWorldStage` here and the files
 * canvas preview (which must keep its imperative live-module host mounted —
 * `active={false}` renders both wrappers as `display: contents`, so flipping
 * flow ↔ world never re-parents the host DOM).
 *
 * Interaction model (camera, not scroll): plain wheel pans, ctrl+wheel
 * (trackpad pinch) zooms at the cursor, background drag pans, double-click
 * toggles fit ↔ 100%. No focus gate — wheel-pan is standard canvas behavior
 * and the world shell has no competing scroll target.
 */
export function WorldViewportFrame({
  active,
  "aria-label": ariaLabel,
  camera,
  children,
  onEmptyClick,
  viewportSlot,
  zoomSlot,
}: {
  active: boolean;
  "aria-label"?: string | undefined;
  camera: WorldCameraApi;
  children: ReactNode;
  onEmptyClick?: (() => void) | undefined;
  viewportSlot: string;
  zoomSlot: string;
}) {
  const gridStyle = computeDotGridStyle(active, camera.camera);

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: focusable canvas exposes zoom/pan shortcuts
    <section
      aria-label={active ? ariaLabel : undefined}
      className={cn(
        active
          ? "absolute inset-0 overflow-hidden bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
          : "contents",
        active && !camera.camera && "invisible",
        active && resolveViewportCursor(camera),
        active && camera.panning && "select-none"
      )}
      data-slot={viewportSlot}
      onDoubleClick={
        active
          ? (event) => {
              const target = event.target;
              if (
                target === event.currentTarget ||
                (target instanceof Element &&
                  !target.closest(INTERACTIVE_PAN_IGNORE))
              ) {
                camera.toggleZoom();
              }
            }
          : undefined
      }
      onKeyDown={active ? camera.handleKeyDown : undefined}
      onPointerCancel={
        active
          ? (event) => camera.endPanSession(event, onEmptyClick)
          : undefined
      }
      onPointerDown={active ? camera.handlePointerDown : undefined}
      onPointerMove={active ? camera.handlePointerMove : undefined}
      onPointerUp={
        active
          ? (event) => camera.endPanSession(event, onEmptyClick)
          : undefined
      }
      onWheel={active ? camera.handleWheel : undefined}
      ref={(el) => {
        camera.viewportRef.current = el;
      }}
      style={gridStyle}
      tabIndex={active ? 0 : undefined}
    >
      <div
        className={active ? "w-max" : "contents"}
        data-slot={zoomSlot}
        style={active ? camera.cameraStyle : undefined}
      >
        {children}
      </div>
    </section>
  );
}

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
  const getContentSize = useCallback(
    () =>
      worldRef.current ? measureWorldContentBounds(worldRef.current) : null,
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
  const camera = useWorldCamera({
    getContentSize,
    shouldCapturePointer,
  });

  useEffect(() => {
    const world = worldRef.current;
    if (!world || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      camera.measureFit();
    });
    observer.observe(world);
    return () => observer.disconnect();
  }, [camera.measureFit]);

  return (
    <div
      className={cn("group relative min-h-0 flex-1 bg-background", className)}
    >
      <WorldViewportFrame
        active
        aria-label={labels.viewerLabel}
        camera={camera}
        onEmptyClick={onEmptyClick}
        viewportSlot="html-world-viewport"
        zoomSlot="html-world-zoom"
      >
        <div data-slot="html-world" ref={worldRef}>
          {children}
        </div>
      </WorldViewportFrame>
      {onOpenFullscreen && expandable ? (
        <MediaFullscreenButton label={expandLabel} onClick={onOpenFullscreen} />
      ) : null}
      <ImagePreviewControls
        effectiveZoom={camera.effectiveZoom}
        labels={labels}
        onZoomChange={camera.setZoom}
        onZoomIn={() => camera.adjustZoom(1)}
        onZoomOut={() => camera.adjustZoom(-1)}
        zoom={camera.zoom}
      />
    </div>
  );
}

/**
 * HTML world on the same zoom/pan stage as image / mermaid preview.
 *
 * `card` — static fit-all snapshot (does not capture wheel / page scroll).
 * `stage` — ContentPreviewHost fullscreen: fit by default, wheel/buttons zoom,
 * drag pan. Live-module canvas preview must NOT wrap this; it keeps a stable
 * host DOM and consumes `useZoomPanViewport` directly (design §3.4).
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
