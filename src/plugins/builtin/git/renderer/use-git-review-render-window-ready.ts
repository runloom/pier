import type { PierDiffViewRenderWindow } from "@pier/ui/diff-view.tsx";
import { type RefObject, useCallback, useRef, useState } from "react";

/** 视口内至少一项、且无可见项仍为 estimate 时，允许揭开首屏正文。 */
export function isReviewRenderWindowFirstPaintReady(
  window: PierDiffViewRenderWindow
): boolean {
  return (
    window.visibleItemIds.length > 0 &&
    !window.visibleItemIds.some((id) => window.estimatedItemIds.includes(id))
  );
}

/**
 * 消费 render window 报告：转发 demand、通知导航，并在可见项就绪后解锁首屏。
 * 缓冲区内 estimate 不阻塞 first paint。
 */
export function useGitReviewRenderWindowReady(options: {
  readonly activeRef: RefObject<boolean>;
  readonly notifyRenderWindowApplied: (
    window: PierDiffViewRenderWindow
  ) => void;
  readonly requestRenderWindow: (window: PierDiffViewRenderWindow) => void;
}): {
  readonly handleRenderWindowChange: (window: PierDiffViewRenderWindow) => void;
  readonly renderWindowReady: boolean;
} {
  const [renderWindowReady, setRenderWindowReady] = useState(false);
  const renderWindowReadyRef = useRef(false);
  const requestRenderWindowRef = useRef(options.requestRenderWindow);
  const notifyRenderWindowAppliedRef = useRef(
    options.notifyRenderWindowApplied
  );
  requestRenderWindowRef.current = options.requestRenderWindow;
  notifyRenderWindowAppliedRef.current = options.notifyRenderWindowApplied;

  const handleRenderWindowChange = useCallback(
    (window: PierDiffViewRenderWindow) => {
      if (!options.activeRef.current) {
        return;
      }
      requestRenderWindowRef.current(window);
      notifyRenderWindowAppliedRef.current(window);
      if (
        !renderWindowReadyRef.current &&
        isReviewRenderWindowFirstPaintReady(window)
      ) {
        renderWindowReadyRef.current = true;
        setRenderWindowReady(true);
      }
    },
    [options.activeRef]
  );

  return { handleRenderWindowChange, renderWindowReady };
}
