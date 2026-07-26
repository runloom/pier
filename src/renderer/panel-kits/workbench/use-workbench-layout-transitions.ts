import { useEffect, useRef, useState } from "react";

/**
 * Suppress RGL layout transitions while the container width settles
 * (open / measure / column changes), then re-enable drag settle animations.
 */
export function useWorkbenchLayoutTransitions(viewportWidth: number): boolean {
  const [ready, setReady] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (viewportWidth <= 0) {
      setReady(false);
      return;
    }
    setReady(false);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setReady(true);
      timerRef.current = null;
    }, 50);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [viewportWidth]);

  return ready;
}
