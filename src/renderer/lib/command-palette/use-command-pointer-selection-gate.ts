import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";

/**
 * cmdk 默认在 pointermove 时立刻选中指针下的 item。面板打开时指针常停在
 * 列表中部，会把高亮和滚动一起拉到中间。
 *
 * 打开 / 换 query / 换 session 后，在捕获阶段吞掉“静止落点”的 pointermove；
 * 直到指针发生真实位移，才放行当前事件到 item（同一次移动即可改选中）。
 */
export function useCommandPointerSelectionGate(
  resetKey: string | number | boolean
): {
  onPointerMoveCapture: (event: ReactPointerEvent<HTMLElement>) => void;
} {
  const gatedRef = useRef(true);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey intentionally re-arms the gate for each open/query/session.
  useEffect(() => {
    gatedRef.current = true;
    lastPointerRef.current = null;
  }, [resetKey]);

  const onPointerMoveCapture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!gatedRef.current) {
        return;
      }
      const previous = lastPointerRef.current;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      if (
        previous &&
        (previous.x !== event.clientX || previous.y !== event.clientY)
      ) {
        gatedRef.current = false;
        return;
      }
      event.stopPropagation();
    },
    []
  );

  return { onPointerMoveCapture };
}
