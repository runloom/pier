import { type ReactNode, useEffect, useRef, useState } from "react";
import { cx } from "./chrome.tsx";

const PUSH_EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]";
const PUSH_DURATION = "duration-[220ms]";

/**
 * 一层推入栈：底是上一层，顶是当前页。
 * 前进：新页从右进，底页左移 25%。返回：反向。
 * 横滑只表示更深一层（主机 → 这台电脑 → 会话 / 通知）。
 */
export function SlideStack(props: {
  base: ReactNode;
  overlay: ReactNode | null;
  overlayKey: string | null;
}): ReactNode {
  const lastOverlay = useRef<ReactNode>(props.overlay);
  if (props.overlay !== null) {
    lastOverlay.current = props.overlay;
  }

  const [visible, setVisible] = useState(props.overlayKey !== null);
  const [mountedKey, setMountedKey] = useState(props.overlayKey);

  useEffect(() => {
    if (props.overlayKey !== null) {
      setMountedKey(props.overlayKey);
      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
        });
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    setVisible(false);
    return undefined;
  }, [props.overlayKey]);

  const overlayMounted = mountedKey !== null;

  return (
    <div className="relative h-full overflow-hidden">
      <div
        className={cx(
          "h-full transition-transform",
          PUSH_DURATION,
          PUSH_EASE,
          "motion-reduce:transform-none motion-reduce:transition-none",
          visible ? "-translate-x-1/4 pointer-events-none" : "translate-x-0"
        )}
      >
        {props.base}
      </div>
      {overlayMounted ? (
        <div
          className={cx(
            "absolute inset-0 z-10 bg-background transition-transform",
            PUSH_DURATION,
            PUSH_EASE,
            "motion-reduce:transform-none motion-reduce:transition-opacity motion-reduce:duration-100",
            visible ? "translate-x-0" : "translate-x-full",
            "motion-reduce:translate-x-0",
            visible ? "motion-reduce:opacity-100" : "motion-reduce:opacity-0"
          )}
          data-slot="mobile-slide-overlay"
          onTransitionEnd={(event) => {
            if (event.target !== event.currentTarget) {
              return;
            }
            if (props.overlayKey === null) {
              setMountedKey(null);
            }
          }}
        >
          {lastOverlay.current}
        </div>
      ) : null}
    </div>
  );
}
