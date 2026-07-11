import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { beginTerminalPanelWebDragCapture } from "@/stores/terminal-input-routing-slice.ts";
import type { FloatingPoint } from "./terminal-floating-geometry.ts";

const DRAG_FALLBACK_MS = 5000;

interface FloatingDragSession {
  capture: { dispose(): void };
  latestDesired: FloatingPoint;
  pointerId: number;
  startClient: FloatingPoint;
  startPoint: FloatingPoint;
  timer: number;
}

interface UseTerminalPanelFloatingDragOptions {
  constrain(point: FloatingPoint): FloatingPoint;
  onCancel(): void;
  onCommit(point: FloatingPoint): void;
  onMove(point: FloatingPoint): void;
  panelId: string;
  panelRootRef: RefObject<HTMLDivElement | null>;
  pointRef: RefObject<FloatingPoint>;
}

/**
 * 终端浮层拖拽会话。
 *
 * 抓手只负责开始会话；移动与结束统一监听 window Pointer Events。这样即使指针
 * 离开抓手，或 Electron 在 Chromium 与原生终端视图之间切换命中区域，拖拽仍由
 * 同一会话接管。会话存续期间同时把整个 terminal panel 注册为 Web 事件覆盖区。
 */
export function useTerminalPanelFloatingDrag({
  constrain,
  onCancel,
  onCommit,
  onMove,
  panelId,
  panelRootRef,
  pointRef,
}: UseTerminalPanelFloatingDragOptions): {
  dragging: boolean;
  onPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void;
} {
  const callbacksRef = useRef({ constrain, onCancel, onCommit, onMove });
  const dragRef = useRef<FloatingDragSession | null>(null);
  const frameRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    callbacksRef.current = { constrain, onCancel, onCommit, onMove };
  }, [constrain, onCancel, onCommit, onMove]);

  const finishDrag = useCallback((commit: boolean) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    dragRef.current = null;
    window.clearTimeout(drag.timer);
    drag.capture.dispose();
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setDragging(false);
    if (!commit) {
      callbacksRef.current.onCancel();
      return;
    }
    const finalPoint = callbacksRef.current.constrain(drag.latestDesired);
    callbacksRef.current.onMove(finalPoint);
    callbacksRef.current.onCommit(finalPoint);
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      const desired = {
        x: drag.startPoint.x + event.clientX - drag.startClient.x,
        y: drag.startPoint.y + event.clientY - drag.startClient.y,
      };
      drag.latestDesired = desired;
      window.clearTimeout(drag.timer);
      drag.timer = window.setTimeout(() => finishDrag(false), DRAG_FALLBACK_MS);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        callbacksRef.current.onMove(callbacksRef.current.constrain(desired));
      });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) {
        finishDrag(true);
      }
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) {
        finishDrag(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) {
        event.preventDefault();
        finishDrag(false);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        finishDrag(false);
      }
    };
    const onBlur = () => finishDrag(false);

    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("visibilitychange", onVisibilityChange, true);
    return () => {
      finishDrag(false);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
        true
      );
    };
  }, [finishDrag]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || dragRef.current) {
        return;
      }
      const root = panelRootRef.current;
      const startPoint = pointRef.current;
      if (!(root && startPoint)) {
        return;
      }
      event.preventDefault();
      const capture = beginTerminalPanelWebDragCapture(panelId, root);
      dragRef.current = {
        capture,
        latestDesired: startPoint,
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        startPoint,
        timer: window.setTimeout(() => finishDrag(false), DRAG_FALLBACK_MS),
      };
      setDragging(true);
    },
    [finishDrag, panelId, panelRootRef, pointRef]
  );

  return { dragging, onPointerDown };
}
