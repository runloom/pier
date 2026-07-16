import { useCallback, useEffect, useRef } from "react";
import { isRenderedItemVisible } from "./diff-view-render-watchdog.ts";

interface RenderedWindowItem {
  readonly element: Element;
  readonly id: string;
  readonly version: number | undefined;
}

export interface PierDiffViewRenderWindow {
  /** Pierre 已渲染但位于真实视口外的官方缓冲项。 */
  readonly bufferedItemIds: readonly string[];
  /** 与 CodeView 滚动容器真实视口相交的项。 */
  readonly visibleItemIds: readonly string[];
}

export function useDiffRenderWindowReport(
  getContainer: () => Element | undefined,
  getRenderedItems: () => readonly RenderedWindowItem[],
  onChange: ((window: PierDiffViewRenderWindow) => void) | undefined
): () => void {
  const frameRef = useRef<number | null>(null);
  const previousKeyRef = useRef("");

  const scheduleReport = useCallback(() => {
    if (!onChange || frameRef.current !== null) {
      return;
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const container = getContainer();
      const visibleItemIds: string[] = [];
      const bufferedItemIds: string[] = [];
      for (const item of getRenderedItems()) {
        (isRenderedItemVisible(container, [item], item.id)
          ? visibleItemIds
          : bufferedItemIds
        ).push(item.id);
      }
      const window = { bufferedItemIds, visibleItemIds };
      const key = JSON.stringify(window);
      if (previousKeyRef.current === key) {
        return;
      }
      previousKeyRef.current = key;
      onChange(window);
    });
  }, [getContainer, getRenderedItems, onChange]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    []
  );

  return scheduleReport;
}
