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
  KEYBOARD_PAN_STEP_PX,
  measureContainScale,
  PAN_CLICK_SLOP_PX,
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
  enabled = true,
  getNaturalSize,
  resetKey,
  shouldCapturePointer,
}: {
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
        viewportHeight: viewport.clientHeight,
        viewportWidth: viewport.clientWidth,
      })
    );
    setLayoutReady(true);
  }, [getNaturalSize]);

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
  useEffect(() => {
    prevEffectiveZoomRef.current = null;
    setLayoutReady(false);
    setFitScale(1);
    setZoom("fit");
  }, [resetKey]);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }
    measureFit();
  }, [enabled, measureFit]);

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
      adjustZoom(event.deltaY < 0 ? 1 : -1);
    },
    [adjustZoom, enabled]
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
