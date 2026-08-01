import type { PierDiffViewRenderWindow } from "@pier/ui/diff-view/index.tsx";
import { type RefObject, useCallback, useRef, useState } from "react";

/**
 * 视口内至少一项即可揭开首屏。
 *
 * 旧逻辑要求「可见项全非 estimate」才解锁：冷开全是 estimate 时永远不满足，
 * CodeView 又被 `invisible` 盖住 → window 报了也仍显示整页「正在加载变更」骨架，
 * 真正文水合后用户仍看不到。estimate 用槽内 pulse 骨架表达加载即可。
 */
export function isReviewRenderWindowFirstPaintReady(
  window: PierDiffViewRenderWindow
): boolean {
  return window.visibleItemIds.length > 0;
}

/**
 * 消费 render window 报告：转发 demand、通知导航，并在有可见项后解锁首屏。
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
