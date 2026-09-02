/**
 * World-stage camera: one `translate + scale`. Math is in `canvas-math.ts`.
 */
import {
  type CSSProperties,
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
  clampZoom,
  fitCamera,
  isEditableOrControl,
  KEYBOARD_PAN_STEP_PX,
  PAN_CLICK_SLOP_PX,
  PINCH_ZOOM_SENSITIVITY,
  softClampCamera,
  type WorldCamera,
  type WorldCameraLookAt,
  type WorldSizeBox,
  ZOOM_FACTOR,
  zoomCameraAt,
} from "./canvas-math.ts";
import {
  applyWorldCameraReset,
  applyWorldCameraViewportResize,
  type CameraPanSession,
  lookAtFromCamera,
  recalledFreeLookAt,
  sameWorldCamera,
  stampWorldCameraLookAt,
  type WorldCameraHookInput,
} from "./world-camera-reset.ts";
import { useWorldCameraSpacePan } from "./world-camera-space-pan.ts";

export type WorldCameraZoomLevel = number | "fit";

const INTERACT_IDLE_MS = 200;

export function useWorldCamera({
  enabled = true,
  getContentSize,
  recall,
  resetKey,
  shouldCapturePointer,
}: WorldCameraHookInput) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const enabledRef = useRef(false);
  const [camera, setCamera] = useState<WorldCamera | null>(null);
  /** `fit` follows viewport/content resizes; any user move flips to `free`. */
  const [mode, setMode] = useState<"fit" | "free">("fit");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [panning, setPanning] = useState(false);
  const { spacePressed, spacePressedRef } = useWorldCameraSpacePan(
    enabled,
    viewportRef
  );
  const [interacting, setInteracting] = useState(false);
  const interactTimerRef = useRef(0);
  const panSessionRef = useRef<CameraPanSession | null>(null);
  const wheelPanRef = useRef({ dx: 0, dy: 0, raf: 0 });
  const recallRef = useRef(recall);
  recallRef.current = recall;
  const lookAtRef = useRef<WorldCameraLookAt | null>(null);
  const appliedResetKeyRef = useRef<string | number | null>(null);

  const viewportBox = useCallback((): WorldSizeBox | null => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return null;
    }
    const box = {
      height: viewport.clientHeight,
      width: viewport.clientWidth,
    };
    return box.width > 0 && box.height > 0 ? box : null;
  }, []);

  /** Rasterize text at the final scale once interaction settles. */
  const markInteracting = useCallback(() => {
    setInteracting(true);
    window.clearTimeout(interactTimerRef.current);
    interactTimerRef.current = window.setTimeout(() => {
      setInteracting(false);
    }, INTERACT_IDLE_MS);
  }, []);
  useEffect(
    () => () => {
      window.clearTimeout(interactTimerRef.current);
      cancelAnimationFrame(wheelPanRef.current.raf);
    },
    []
  );

  const applyCamera = useCallback(
    (update: (current: WorldCamera) => WorldCamera) => {
      setMode("free");
      setCamera((current) => {
        if (!current) {
          return current;
        }
        const next = update(current);
        const content = getContentSize();
        const viewport = viewportBox();
        const clamped =
          content && viewport ? softClampCamera(next, content, viewport) : next;
        stampWorldCameraLookAt(clamped, viewport, lookAtRef);
        return clamped;
      });
    },
    [getContentSize, viewportBox]
  );

  const measureFit = useCallback(
    (force = false) => {
      if (!(force || modeRef.current === "fit")) {
        return;
      }
      const content = getContentSize();
      const viewport = viewportBox();
      if (!(content && viewport && content.width > 0 && content.height > 0)) {
        return;
      }
      const next = fitCamera(content, viewport);
      setMode("fit");
      lookAtRef.current = null;
      setCamera((current) => sameWorldCamera(current, next));
    },
    [getContentSize, viewportBox]
  );

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }
    const identity = resetKey ?? "";
    if (appliedResetKeyRef.current === identity) {
      return;
    }
    const pendingLookAt = recalledFreeLookAt(recallRef.current?.() ?? null);
    const viewport = viewportBox();
    if (
      pendingLookAt &&
      !(viewport && viewport.width > 0 && viewport.height > 0)
    ) {
      return;
    }
    appliedResetKeyRef.current = identity;
    const result = applyWorldCameraReset({
      getContentSize,
      lookAtRef,
      measureFit,
      modeRef,
      recall: recallRef.current,
      setCamera: (pose) => {
        setCamera(pose);
      },
      setMode,
      viewportBox,
    });
    if (result === "cleared") {
      setCamera(null);
      setMode("fit");
      modeRef.current = "fit";
    }
  }, [enabled, getContentSize, measureFit, resetKey, viewportBox]);

  useLayoutEffect(() => {
    const becameEnabled = enabled && !enabledRef.current;
    enabledRef.current = enabled;
    if (!enabled) {
      return;
    }
    measureFit(becameEnabled && modeRef.current === "fit");
  }, [enabled, measureFit]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!(enabled && viewport) || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      applyWorldCameraViewportResize({
        getContentSize,
        lookAtRef,
        measureFit,
        modeRef,
        setCamera: (pose) => {
          setCamera(pose);
        },
        viewportBox,
      });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [enabled, getContentSize, measureFit, viewportBox]);

  const zoomAtViewportCenter = useCallback(
    (nextScale: number) => {
      const viewport = viewportBox();
      if (!viewport) {
        return;
      }
      applyCamera((current) =>
        zoomCameraAt(
          current,
          { x: viewport.width / 2, y: viewport.height / 2 },
          nextScale
        )
      );
    },
    [applyCamera, viewportBox]
  );

  const adjustZoom = useCallback(
    (direction: 1 | -1) => {
      markInteracting();
      const current = camera?.scale ?? 1;
      zoomAtViewportCenter(
        clampZoom(direction > 0 ? current * ZOOM_FACTOR : current / ZOOM_FACTOR)
      );
    },
    [camera, markInteracting, zoomAtViewportCenter]
  );

  const setZoom = useCallback(
    (level: WorldCameraZoomLevel) => {
      markInteracting();
      if (level === "fit") {
        measureFit(true);
        return;
      }
      zoomAtViewportCenter(level);
    },
    [markInteracting, measureFit, zoomAtViewportCenter]
  );

  const toggleZoom = useCallback(() => {
    setZoom(modeRef.current === "fit" ? 1 : "fit");
  }, [setZoom]);

  const flushWheelPan = useCallback(() => {
    wheelPanRef.current.raf = 0;
    const { dx, dy } = wheelPanRef.current;
    wheelPanRef.current.dx = 0;
    wheelPanRef.current.dy = 0;
    if (dx === 0 && dy === 0) {
      return;
    }
    applyCamera((current) => ({
      scale: current.scale,
      x: current.x - dx,
      y: current.y - dy,
    }));
  }, [applyCamera]);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }
      event.preventDefault();
      markInteracting();
      let deltaX = event.deltaX;
      let deltaY = event.deltaY;
      if (event.deltaMode === 1) {
        deltaX *= 16;
        deltaY *= 16;
      } else if (event.deltaMode === 2) {
        deltaX *= 100;
        deltaY *= 100;
      }

      // Trackpad pinch or Ctrl/Cmd + wheel arrives as ctrlKey or metaKey — smooth zoom at the cursor.
      if (event.ctrlKey || event.metaKey) {
        const viewport = viewportRef.current;
        if (!viewport || deltaY === 0) {
          return;
        }
        const rect = viewport.getBoundingClientRect();
        const point = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
        applyCamera((current) =>
          zoomCameraAt(
            current,
            point,
            clampZoom(
              current.scale * Math.exp(-deltaY * PINCH_ZOOM_SENSITIVITY)
            )
          )
        );
        return;
      }
      // Plain wheel / two-finger scroll pans, like every canvas tool.
      // Shift+wheel converts vertical scroll to horizontal pan if deltaX is 0.
      if (event.shiftKey && deltaX === 0) {
        wheelPanRef.current.dx += deltaY;
      } else {
        wheelPanRef.current.dx += deltaX;
        wheelPanRef.current.dy += deltaY;
      }
      if (wheelPanRef.current.raf === 0) {
        wheelPanRef.current.raf = requestAnimationFrame(flushWheelPan);
      }
    },
    [applyCamera, enabled, flushWheelPan, markInteracting]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }
      const target = event.target;
      if (
        target instanceof Element &&
        target !== event.currentTarget &&
        isEditableOrControl(target)
      ) {
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        adjustZoom(1);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        adjustZoom(-1);
      } else if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
      } else if (event.key.startsWith("Arrow")) {
        const step = event.shiftKey
          ? KEYBOARD_PAN_STEP_PX * 3
          : KEYBOARD_PAN_STEP_PX;
        let dx = 0;
        let dy = 0;
        if (event.key === "ArrowLeft") {
          dx = -step;
        } else if (event.key === "ArrowRight") {
          dx = step;
        } else if (event.key === "ArrowUp") {
          dy = -step;
        } else if (event.key === "ArrowDown") {
          dy = step;
        }
        if (dx !== 0 || dy !== 0) {
          event.preventDefault();
          markInteracting();
          applyCamera((current) => ({
            scale: current.scale,
            x: current.x - dx,
            y: current.y - dy,
          }));
        }
      }
    },
    [adjustZoom, applyCamera, enabled, markInteracting, setZoom]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }
      const isMiddleClick = event.button === 1;
      const isLeftClick = event.button === 0;
      if (!(isLeftClick || isMiddleClick)) {
        return;
      }
      const current = camera;
      if (!current) {
        return;
      }
      const isSpacePan = spacePressedRef.current;
      const fromEmpty = event.target === event.currentTarget;
      if (
        !(isMiddleClick || isSpacePan) &&
        shouldCapturePointer &&
        !shouldCapturePointer(event) &&
        !fromEmpty
      ) {
        return;
      }
      if (isMiddleClick || isSpacePan) {
        event.preventDefault();
      }
      panSessionRef.current = {
        fromEmpty: fromEmpty && !isMiddleClick && !isSpacePan,
        moved: false,
        originX: current.x,
        originY: current.y,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      if (typeof event.currentTarget.setPointerCapture === "function") {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      setPanning(true);
    },
    [camera, enabled, shouldCapturePointer, spacePressedRef]
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
      if (!session.moved) {
        return;
      }
      event.preventDefault();
      markInteracting();
      applyCamera((current) => ({
        scale: current.scale,
        x: session.originX + dx,
        y: session.originY + dy,
      }));
    },
    [applyCamera, markInteracting]
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

  const effectiveZoom = camera?.scale ?? 1;
  const cameraStyle: CSSProperties | undefined = camera
    ? {
        transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
        transformOrigin: "0 0",
        ...(interacting ? { willChange: "transform" } : {}),
      }
    : undefined;

  const lookAt = lookAtFromCamera(camera, mode, viewportBox());

  return {
    adjustZoom,
    camera,
    cameraStyle,
    effectiveZoom,
    endPanSession,
    handleKeyDown,
    handlePointerDown,
    handlePointerMove,
    handleWheel,
    lookAt,
    measureFit,
    panning,
    setZoom,
    spacePressed,
    toggleZoom,
    viewportRef,
    zoom: (mode === "fit" ? "fit" : effectiveZoom) as WorldCameraZoomLevel,
  };
}

export type WorldCameraApi = ReturnType<typeof useWorldCamera>;
