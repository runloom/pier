/**
 * 活动总览密度：结构取舍（是否列表 / 行数 / meta），排列交给 container query。
 *
 * compact（h≤2）= 纯 KPI 摘要条，不展示活动列表与大空态。
 * 不以宽度把 h=3 卡强行压成 compact（避免大面积留白只剩小 pills）。
 */

import {
  type WorkbenchWidgetDensity,
  workbenchDensityFor,
} from "@/lib/workbench/kpi-auto-layout.ts";

export type ActivityDensity = WorkbenchWidgetDensity;

export function activityDensityFor(size: {
  h: number;
  w: number;
}): ActivityDensity {
  return workbenchDensityFor(size);
}

/**
 * 是否渲染活动列表 / 空态正文。
 * compact 小卡只保留 KPI 摘要，不展示具体活动项（也无大空态）。
 */
export function activityShowList(density: ActivityDensity): boolean {
  return density !== "compact";
}

/** 列表可见行上限；compact 不渲染列表故为 0。 */
export function activityRowLimitFor(
  density: ActivityDensity,
  height: number
): number {
  if (density === "compact") {
    return 0;
  }
  if (density === "medium") {
    return height <= 3 ? 5 : 8;
  }
  if (height >= 6) {
    return 16;
  }
  if (height >= 5) {
    return 12;
  }
  return 8;
}

/** full 或较宽 medium 显示次行 kind meta。 */
export function activityShowRowMeta(
  density: ActivityDensity,
  width: number
): boolean {
  return density === "full" || (density === "medium" && width >= 5);
}

/** medium/full 且有垂直空间时展示「其他窗口智能体」footer。 */
export function activityShowIndexFooter(
  density: ActivityDensity,
  height: number
): boolean {
  if (density === "compact") {
    return false;
  }
  return height >= 4;
}
