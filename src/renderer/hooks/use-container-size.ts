import { useCallback, useEffect, useRef, useState } from "react";

const FALLBACK_SIZE = { height: 600, width: 800 };

interface ContainerSize {
  height: number;
  width: number;
}

/**
 * 量测可滚动容器的 content box。clientWidth/clientHeight 包含 padding，
 * 因此按 computed style 各扣一次；ResizeObserver 只用于通知重新读取。
 */
export function useContainerSize(): [
  React.RefCallback<HTMLDivElement>,
  ContainerSize,
  () => void,
] {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [size, setSize] = useState<ContainerSize>(FALLBACK_SIZE);

  const remeasure = useCallback(() => {
    const node = nodeRef.current;
    if (!node) {
      return;
    }
    const style = window.getComputedStyle(node);
    const paddingX =
      (Number.parseFloat(style.paddingLeft) || 0) +
      (Number.parseFloat(style.paddingRight) || 0);
    const paddingY =
      (Number.parseFloat(style.paddingTop) || 0) +
      (Number.parseFloat(style.paddingBottom) || 0);
    const width = node.clientWidth - paddingX;
    const height = node.clientHeight - paddingY;
    if (width <= 0 || height <= 0) {
      return;
    }
    setSize((current) =>
      current.width === width && current.height === height
        ? current
        : { height, width }
    );
  }, []);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      nodeRef.current = node;
      if (!node) {
        return;
      }

      remeasure();
      if (typeof ResizeObserver !== "undefined") {
        observerRef.current = new ResizeObserver(remeasure);
        observerRef.current.observe(node);
      }
    },
    [remeasure]
  );

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      nodeRef.current = null;
    },
    []
  );

  return [ref, size, remeasure];
}
