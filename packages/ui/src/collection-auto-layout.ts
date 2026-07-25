import type { CSSProperties } from "react";
import { cn } from "./utils.ts";

/**
 * 同构集合自动布局（KPI / 配额窗等）。
 *
 * - 2+ 项：`auto-fit` + `minmax`，宽→横排铺满，窄→自然换行。
 * - 单项：满宽 block/flex，禁止单独 auto-fit 留半行空轨。
 * - 列定义走 **inline style**（避免 Tailwind 动态任意值 / CSS 变量未生成导致永远单列）。
 * - `size` 只做结构决策（密度 / 是否 footer），不决定横竖。
 */

export type WidgetDensity = "compact" | "medium" | "full";

/** 工作台 KPI 条：标签 + 数字。 */
export const COLLECTION_KPI_ITEM_MIN_WIDTH = "6.5rem";

/**
 * 工作台配额进度条：标签 + 百分比 + 进度轨。
 * 略小于设置页宽卡，便于 w=4 物料横排两项。
 */
export const COLLECTION_QUOTA_ITEM_MIN_WIDTH = "12rem";

/** 设置页配额组：更宽单项，避免窄挤。 */
export const COLLECTION_QUOTA_SETTINGS_ITEM_MIN_WIDTH = "14rem";

export function widgetDensityFor(size: {
  h: number;
  w: number;
}): WidgetDensity {
  if (size.h <= 2) {
    return "compact";
  }
  if (size.h <= 3) {
    return "medium";
  }
  return "full";
}

export function collectionLayoutMode(
  itemCount: number
): "single" | "auto-fit" | "empty" {
  if (itemCount <= 0) {
    return "empty";
  }
  if (itemCount === 1) {
    return "single";
  }
  return "auto-fit";
}

export function collectionAutoFitGridTemplate(
  itemCount: number,
  minWidth: string
): string | undefined {
  if (itemCount <= 1) {
    return;
  }
  return `repeat(auto-fit, minmax(min(100%, ${minWidth}), 1fr))`;
}

/**
 * 集合容器 class。
 * @param itemCount 0/1 → 满宽；2+ → grid（列在 style 里）
 * @param singleAs 单项时用 flex 列（进度条纵向间距）还是 block
 */
export function collectionAutoFitClassName(
  itemCount: number,
  options?: {
    gapClassName?: string;
    singleAs?: "block" | "flex";
  }
): string {
  const gap = options?.gapClassName ?? "gap-3";
  const singleAs = options?.singleAs ?? "flex";
  if (itemCount <= 1) {
    if (singleAs === "block") {
      return cn("block w-full min-w-0 shrink-0");
    }
    return cn("flex w-full min-w-0 shrink-0 flex-col", gap);
  }
  return cn("grid w-full min-w-0 shrink-0 content-start", gap);
}

export function collectionAutoFitStyle(
  itemCount: number,
  minWidth: string
): CSSProperties | undefined {
  const columns = collectionAutoFitGridTemplate(itemCount, minWidth);
  if (!columns) {
    return;
  }
  return { gridTemplateColumns: columns };
}

/** 工作台物料根壳：密度 padding / 顶对齐 / 禁溢出。 */
export function widgetShellClassName(density: WidgetDensity): string {
  return density === "compact"
    ? "flex h-full min-h-0 flex-col justify-start gap-2 overflow-hidden p-2.5"
    : "flex h-full min-h-0 flex-col justify-start gap-3 overflow-hidden p-3";
}
