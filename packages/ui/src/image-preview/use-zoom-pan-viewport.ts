import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  anchoredScrollAfterZoom,
  centeredScroll,
  clampZoom,
  fitInsetsPadY,
  type ImagePreviewChrome,
  imagePreviewFitInsets,
  KEYBOARD_PAN_STEP_PX,
  measureContainScale,
  PAN_CLICK_SLOP_PX,
  pinchZoom,
  ZOOM_FACTOR,
} from "./canvas-math.ts";

export type ZoomPanLevel = number | "fit";

interface PanSession {
  fromEmpty: boolean;
  moved: boolean;
  originScrollLeft: number;
  originScrollTop: number;
  pointerId: number;
  startX: number;
  startY: number;
}

export function useZoomPanViewport({
  chrome = "board",
  enabled = true,
  getNaturalSize,
  resetKey,
  shouldCapturePointer,
}: {
  chrome?: ImagePreviewChrome;
  enabled?: boolean;
  getNaturalSize: () => { height: number; width: number } | null;
  resetKey?: string | number | null;
  shouldCapturePointer?: (event: ReactPointerEvent<HTMLElement>) => boolean;
}) {
  const [zoom, setZoom] = useState<ZoomPanLevel>("fit");
  const [fitScale, setFitScale] = useState(1);
  const [layoutReady, setLayoutReady] = useState(false);
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef<HTMLElement | null>(null);
  const panSessionRef = useRef<PanSession | null>(null);
  const prevEffectiveZoomRef = useRef<number | null>(null);
  /** Pointer position for the next zoom application (wheel/pinch anchor). */
  const pendingAnchorRef = useRef<{ x: number; y: number } | null>(null);

  const effectiveZoom = zoom === "fit" ? fitScale : zoom;
  const canPan = zoom !== "fit";

  const measureFit = useCallback(() => {
    const viewport = viewportRef.current;
    const natural = getNaturalSize();
    if (!(viewport && natural && natural.width > 0 && natural.height > 0)) {
      return;
    }
    setFitScale(
      measureContainScale({
        naturalHeight: natural.height,
        naturalWidth: natural.width,
        // Overlay: title band + zoom pill. Board: p-3 top + zoom pill.
        paddingYPx: fitInsetsPadY(imagePreviewFitInsets(chrome)),
        viewportHeight: viewport.clientHeight,
        viewportWidth: viewport.clientWidth,
      })
    );
    setLayoutReady(true);
  }, [chrome, getNaturalSize]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is the world identity trigger
  useLayoutEffect(() => {
    prevEffectiveZoomRef.current = null;
    setLayoutReady(false);
    setFitScale(1);
    setZoom("fit");
  }, [resetKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey retriggers measure after identity swap
  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }
    measureFit();
  }, [enabled, measureFit, resetKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!(enabled && viewport) || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      measureFit();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [enabled, measureFit]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!(viewport && layoutReady && enabled)) {
      return;
    }
    const previous = prevEffectiveZoomRef.current;
    if (previous === effectiveZoom) {
      return;
    }
    prevEffectiveZoomRef.current = effectiveZoom;
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;

    const overflows =
      viewport.scrollWidth > viewport.clientWidth + 1 ||
      viewport.scrollHeight > viewport.clientHeight + 1;

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
      ...(anchor ? { anchorX: anchor.x, anchorY: anchor.y } : {}),
      clientHeight: viewport.clientHeight,
      clientWidth: viewport.clientWidth,
      newZoom: effectiveZoom,
      oldZoom: previous,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    });
    viewport.scrollLeft = next.scrollLeft;
    viewport.scrollTop = next.scrollTop;
  }, [effectiveZoom, enabled, layoutReady, zoom]);

  useEffect(
    () => () => {
      panSessionRef.current = null;
    },
    []
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }
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
      if (!canPan) {
        return;
      }
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }
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
    [adjustZoom, canPan, enabled]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) {
        return;
      }
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }
      const fromEmpty = event.target === event.currentTarget;
      if (shouldCapturePointer && !shouldCapturePointer(event) && !fromEmpty) {
        return;
      }
      if (!(canPan || fromEmpty)) {
        return;
      }
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
    [canPan, enabled, shouldCapturePointer]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = panSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) {
        return;
      }
      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;
      if (
        !session.moved &&
        (Math.abs(dx) >= PAN_CLICK_SLOP_PX || Math.abs(dy) >= PAN_CLICK_SLOP_PX)
      ) {
        session.moved = true;
      }
      if (!(canPan && session.moved)) {
        return;
      }
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }
      event.preventDefault();
      viewport.scrollLeft = session.originScrollLeft - dx;
      viewport.scrollTop = session.originScrollTop - dy;
    },
    [canPan]
  );

  const endPanSession = useCallback(
    (event: ReactPointerEvent<HTMLElement>, onEmptyClick?: () => void) => {
      const session = panSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) {
        return;
      }
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
    []
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (!enabled || event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      const viewport = viewportRef.current;
      if (viewport) {
        const rect = viewport.getBoundingClientRect();
        pendingAnchorRef.current = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
      }
      // Trackpad pinch arrives as ctrl+wheel — smooth factor, not steps.
      if (event.ctrlKey) {
        const deltaY = event.deltaY;
        setZoom((current) => {
          const base = current === "fit" ? fitScale : current;
          return pinchZoom(base, deltaY);
        });
        return;
      }
      adjustZoom(event.deltaY < 0 ? 1 : -1);
    },
    [adjustZoom, enabled, fitScale]
  );

  return {
    adjustZoom,
    canPan,
    effectiveZoom,
    endPanSession,
    fitScale,
    handleKeyDown,
    handlePointerDown,
    handlePointerMove,
    handleWheel,
    layoutReady,
    measureFit,
    panning,
    setZoom,
    toggleZoom,
    viewportRef,
    zoom,
  };
}
