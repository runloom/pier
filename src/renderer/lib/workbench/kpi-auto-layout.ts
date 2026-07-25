/**
 * 工作台 KPI 自动布局：薄封装 `@pier/ui/collection-auto-layout`（插件与宿主共用）。
 */

import {
  COLLECTION_KPI_ITEM_MIN_WIDTH,
  collectionAutoFitClassName,
  collectionAutoFitStyle,
  collectionLayoutMode,
  type WidgetDensity,
  widgetDensityFor,
} from "@pier/ui/collection-auto-layout.ts";
import type { CSSProperties } from "react";

export const WORKBENCH_KPI_ITEM_MIN_WIDTH = COLLECTION_KPI_ITEM_MIN_WIDTH;

export type WorkbenchWidgetDensity = WidgetDensity;

export function workbenchDensityFor(size: {
  h: number;
  w: number;
}): WorkbenchWidgetDensity {
  return widgetDensityFor(size);
}

export function workbenchKpiLayoutMode(
  itemCount: number
): "single" | "auto-fit" | "empty" {
  return collectionLayoutMode(itemCount);
}

export function workbenchKpiCollectionClassName(itemCount: number): string {
  return collectionAutoFitClassName(itemCount, { singleAs: "block" });
}

export function workbenchKpiCollectionStyle(
  itemCount: number
): CSSProperties | undefined {
  return collectionAutoFitStyle(itemCount, WORKBENCH_KPI_ITEM_MIN_WIDTH);
}

export function workbenchKpiGridTemplateColumns(
  itemCount: number
): string | undefined {
  return workbenchKpiCollectionStyle(itemCount)?.gridTemplateColumns as
    | string
    | undefined;
}

/**
 * 可见 KPI 个数上限：密度 + 宽度做结构取舍，不参与横竖排列。
 * compact 固定 2；medium 宽卡可到 4；full 固定最多 4。
 */
export function workbenchMaxKpisFor(
  density: WorkbenchWidgetDensity,
  width: number
): number {
  if (density === "compact") {
    return 2;
  }
  if (density === "medium") {
    if (width >= 6) {
      return 4;
    }
    if (width >= 4) {
      return 3;
    }
    return 2;
  }
  return 4;
}
