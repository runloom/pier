/**
 * 工作台资源：密度与 KPI **结构**（个数 / 会话列表行数）。
 * KPI **排列**交给 `workbenchKpiCollectionClassName` 内容网格，不在此决定 stack/row。
 */

import {
  type WorkbenchWidgetDensity,
  workbenchDensityFor,
  workbenchMaxKpisFor,
} from "@/lib/workbench/kpi-auto-layout.ts";

export type ResourceDensity = WorkbenchWidgetDensity;

export function densityFor(size: { h: number; w: number }): ResourceDensity {
  return workbenchDensityFor(size);
}

/** KPI 可见数量：totalMemory > totalCpu > appMemory > workloadMemory */
export function maxKpisFor(
  density: ResourceDensity,
  width: number,
  _height = 3
): number {
  return workbenchMaxKpisFor(density, width);
}

/** medium/full 下终端会话列表行数上限。 */
export function processRowLimitFor(
  density: ResourceDensity,
  height: number
): number {
  if (density === "compact") {
    return 0;
  }
  if (density === "medium") {
    return height <= 3 ? 3 : 5;
  }
  if (height >= 6) {
    return 12;
  }
  if (height >= 5) {
    return 8;
  }
  return 6;
}

/** @deprecated 别名：语义上为 session 行上限 */
export const sessionRowLimitFor = processRowLimitFor;

export type ResourceKpiId =
  | "totalMemory"
  | "totalCpu"
  | "appMemory"
  | "workloadMemory";

const KPI_PRIORITY: readonly ResourceKpiId[] = [
  "totalMemory",
  "totalCpu",
  "appMemory",
  "workloadMemory",
];

export function visibleKpiIds(
  density: ResourceDensity,
  width: number,
  height = 3
): readonly ResourceKpiId[] {
  return KPI_PRIORITY.slice(0, maxKpisFor(density, width, height));
}
