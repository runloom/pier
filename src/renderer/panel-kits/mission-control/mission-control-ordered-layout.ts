import type { MissionControlPanelWidgetEntry } from "@shared/contracts/mission-control.ts";
import {
  HOST_MAX_WIDGET_SIZE,
  HOST_MIN_WIDGET_SIZE,
  MISSION_CONTROL_GRID_COLS,
} from "@shared/contracts/mission-control.ts";
import type { LayoutItem } from "react-grid-layout";
import {
  CELL_WIDTH,
  clampSize,
  MARGIN,
  type SizeDeclaration,
} from "./mission-control-grid-geometry.ts";

export const MIN_RESPONSIVE_GRID_COLS = 2;

const GRID_UNIT = CELL_WIDTH + MARGIN[0];

export function resolveResponsiveGridCols(viewportWidth: number): number {
  const measured = Math.floor(
    (Math.max(0, viewportWidth) + MARGIN[0]) / GRID_UNIT
  );
  return Math.max(
    MIN_RESPONSIVE_GRID_COLS,
    Math.min(MISSION_CONTROL_GRID_COLS, measured)
  );
}

function constrainedLayoutItem(
  entry: MissionControlPanelWidgetEntry,
  cols: number,
  declaration: SizeDeclaration | undefined
): Omit<LayoutItem, "x" | "y"> {
  const min = declaration?.minSize ?? HOST_MIN_WIDGET_SIZE;
  const max = declaration?.maxSize ?? HOST_MAX_WIDGET_SIZE;
  const preferred = clampSize({ h: entry.h, w: entry.w }, min, max);
  const minW = Math.min(min.w, cols);
  const maxW = Math.max(minW, Math.min(max.w, cols));
  return {
    h: preferred.h,
    i: entry.id,
    maxH: max.h,
    maxW,
    minH: min.h,
    minW,
    w: Math.max(minW, Math.min(preferred.w, cols)),
  };
}

/**
 * 稳定 Z 字布局：严格按实例数组顺序逐行排布，放不下即换行；
 * 行高取本行最高物料，不把后续小物料回填到前面行内的纵向空白。
 */
export function deriveOrderedMissionControlLayout(
  entries: readonly MissionControlPanelWidgetEntry[],
  options: {
    cols: number;
    getSizeDeclaration?: (instanceId: string) => SizeDeclaration | undefined;
  }
): LayoutItem[] {
  const cols = Math.max(MIN_RESPONSIVE_GRID_COLS, options.cols);
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  const layout: LayoutItem[] = [];

  for (const entry of entries) {
    const item = constrainedLayoutItem(
      entry,
      cols,
      options.getSizeDeclaration?.(entry.id)
    );
    if (x > 0 && x + item.w > cols) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    layout.push({ ...item, x, y });
    x += item.w;
    rowHeight = Math.max(rowHeight, item.h);
  }

  return layout;
}

export function missionControlLayoutRows(
  layout: readonly LayoutItem[]
): number {
  return layout.reduce((bottom, item) => Math.max(bottom, item.y + item.h), 0);
}

export function moveMissionControlEntry(
  entries: readonly MissionControlPanelWidgetEntry[],
  instanceId: string,
  targetIndex: number
): MissionControlPanelWidgetEntry[] {
  const sourceIndex = entries.findIndex((entry) => entry.id === instanceId);
  if (sourceIndex < 0) {
    return [...entries];
  }
  const next = [...entries];
  const [entry] = next.splice(sourceIndex, 1);
  if (!entry) {
    return next;
  }
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, entry);
  return next;
}

export function resolveMissionControlInsertionIndex(
  entries: readonly MissionControlPanelWidgetEntry[],
  input: {
    activeItem: Pick<LayoutItem, "h" | "w" | "x" | "y">;
    cols: number;
    getSizeDeclaration?: (instanceId: string) => SizeDeclaration | undefined;
    instanceId: string;
  }
): number {
  const source = entries.find((entry) => entry.id === input.instanceId);
  if (!source) {
    return -1;
  }
  const remaining = entries.filter((entry) => entry.id !== input.instanceId);
  const activeCenter = {
    x: input.activeItem.x + input.activeItem.w / 2,
    y: input.activeItem.y + input.activeItem.h / 2,
  };
  let best = { distance: Number.POSITIVE_INFINITY, index: 0 };

  for (let index = 0; index <= remaining.length; index++) {
    const candidateEntries = [...remaining];
    candidateEntries.splice(index, 0, source);
    const layout = deriveOrderedMissionControlLayout(candidateEntries, {
      cols: input.cols,
      ...(input.getSizeDeclaration
        ? { getSizeDeclaration: input.getSizeDeclaration }
        : {}),
    });
    const candidate = layout.find((item) => item.i === input.instanceId);
    if (!candidate) {
      continue;
    }
    const dx = candidate.x + candidate.w / 2 - activeCenter.x;
    const dy = candidate.y + candidate.h / 2 - activeCenter.y;
    const distance = dx * dx + dy * dy;
    if (distance < best.distance) {
      best = { distance, index };
    }
  }

  return best.index;
}
