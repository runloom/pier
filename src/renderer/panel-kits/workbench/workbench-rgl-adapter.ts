import {
  calcGridItemPosition,
  getCompactor,
  type LayoutItem,
} from "react-grid-layout";
import { MARGIN, ROW_HEIGHT } from "./workbench-grid-geometry.ts";

export const WORKBENCH_GRID_CONTAINER_PADDING = [0, 0] as const;

// noCompactor 只关闭压实，拖拽碰撞时仍会推开其它条目。这里允许 RGL
// 条目临时重叠，让有序布局算法独占重排策略。
export const WORKBENCH_ORDERED_GRID_COMPACTOR = getCompactor(null, true);

export function alignTransientGridLayout(
  transient: readonly LayoutItem[],
  canonical: readonly LayoutItem[]
): void {
  const canonicalById = new Map(canonical.map((item) => [item.i, item]));
  for (const item of transient) {
    const target = canonicalById.get(item.i);
    if (!target) continue;
    item.x = target.x;
    item.y = target.y;
    item.moved = false;
  }
}

export function workbenchPreviewOffset(
  baseItem: LayoutItem,
  previewItem: LayoutItem,
  options: { cols: number; viewportWidth: number }
): { x: number; y: number } | null {
  const positionParams = {
    cols: options.cols,
    containerPadding: WORKBENCH_GRID_CONTAINER_PADDING,
    containerWidth: Math.max(1, options.viewportWidth),
    margin: MARGIN,
    maxRows: Number.POSITIVE_INFINITY,
    rowHeight: ROW_HEIGHT,
  };
  const basePosition = calcGridItemPosition(
    positionParams,
    baseItem.x,
    baseItem.y,
    baseItem.w,
    baseItem.h
  );
  const previewPosition = calcGridItemPosition(
    positionParams,
    previewItem.x,
    previewItem.y,
    previewItem.w,
    previewItem.h
  );
  const x = previewPosition.left - basePosition.left;
  const y = previewPosition.top - basePosition.top;
  return x === 0 && y === 0 ? null : { x, y };
}

export function workbenchPreviewTransform(
  offset: { x: number; y: number } | undefined
) {
  return offset
    ? { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }
    : undefined;
}
