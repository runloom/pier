import { useCallback, useEffect, useRef, useState } from "react";

/** jsdom 无 ResizeObserver 时的回退宽度。 */
const FALLBACK_WIDTH = 800;

/**
 * 量测容器 div 宽度。
 * 不用 RGL WidthProvider——它只听 window resize，dockview 分栏拖动不触发 window resize。
 * 返回 [refCallback, width]：将 refCallback 挂到容器 div 的 ref prop 上。
 */
export function useContainerWidth(): [
  React.RefCallback<HTMLDivElement>,
  number,
] {
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (!node) {
      return;
    }

    // 预量测与 ResizeObserver 的 contentRect 统一为 content-box：
    // getBoundingClientRect 是 border-box（含 padding），直接用会让首帧
    // 多算 padding 宽度，某些宽度下多渲染一列然后跳变。
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const paddingX =
      (Number.parseFloat(style.paddingLeft) || 0) +
      (Number.parseFloat(style.paddingRight) || 0);
    const contentWidth = rect.width - paddingX;
    if (contentWidth > 0) {
      setWidth(contentWidth);
    }

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    observerRef.current = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const newWidth = entry.contentRect.width;
        if (newWidth > 0) {
          setWidth(newWidth);
        }
      }
    });
    observerRef.current.observe(node);
  }, []);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
    },
    []
  );

  return [ref, width];
}
