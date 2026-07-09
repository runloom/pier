import type {
  MissionControlGridSize,
  MissionControlWidgetLayoutPriority,
  MissionControlWidgetLayoutProfile,
} from "@shared/contracts/mission-control.ts";
import {
  HOST_DEFAULT_WIDGET_SIZE,
  HOST_MAX_WIDGET_SIZE,
  HOST_MIN_WIDGET_SIZE,
  MISSION_CONTROL_GRID_COLS,
} from "@shared/contracts/mission-control.ts";
import type { LayoutItem } from "react-grid-layout";

interface GeometryEntry {
  h: number;
  id: string;
  w: number;
  x: number;
  y: number;
}

interface DeriveLayoutOptions {
  getSizeDeclaration?: (id: string) => SizeDeclaration | undefined;
}

/** 网格行高（px）。 */
export const ROW_HEIGHT = 88;

/** 网格间距（px）。[水平, 垂直]。 */
export const MARGIN: [number, number] = [12, 12];

/** 格子像素宽。与 ROW_HEIGHT 对齐成方格。 */
export const CELL_WIDTH = 88;

/** 一格占位（格宽 + 水平间距）。 */
const GRID_UNIT = CELL_WIDTH + MARGIN[0];

/**
 * 内容区宽度 → 可用列数 k ∈ [1, 12]。
 * k 列网格像素宽 = k*88 + (k-1)*12 = k*100 - 12，故 k = floor((w + 12) / 100)。
 */
export function computeAvailableCols(contentWidth: number): number {
  const k = Math.floor((contentWidth + MARGIN[0]) / GRID_UNIT);
  return Math.max(1, Math.min(MISSION_CONTROL_GRID_COLS, k));
}

/** k 列网格的像素总宽（containerPadding 为 [0,0] 时）。 */
export function gridPixelWidth(cols: number): number {
  return cols * GRID_UNIT - MARGIN[0];
}

/** 阅读序比较：y 优先、x 其次、id 兜底（脏数据同坐标时仍确定）。 */
export function readingOrderCompare(
  a: { id: string; x: number; y: number },
  b: { id: string; x: number; y: number }
): number {
  return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
}

function interpolateHeight(
  width: number,
  lower: MissionControlGridSize,
  upper: MissionControlGridSize
): number {
  if (upper.w === lower.w) {
    return upper.h;
  }
  const ratio = (width - lower.w) / (upper.w - lower.w);
  return Math.round(lower.h + (upper.h - lower.h) * ratio);
}

/**
 * 容器列数下的展示尺寸。显式 minSize 或 maxSize 任一存在即代表自动尺寸；
 * 未显式声明 maxSize 时，宽容器可增长到可用列宽，但高度保持基准高度。
 */
export function resolveResponsiveGridSize(
  preferred: MissionControlGridSize,
  decl: SizeDeclaration | undefined,
  cols: number
): MissionControlGridSize {
  const availableW = Math.max(1, Math.min(MISSION_CONTROL_GRID_COLS, cols));
  const min = decl?.minSize;
  const max = decl?.maxSize;
  const autoSized = min !== undefined || max !== undefined;

  let targetW = Math.min(preferred.w, availableW);
  if (autoSized && availableW > preferred.w) {
    targetW = Math.min(max?.w ?? availableW, availableW);
  }
  if (min && targetW < min.w) {
    targetW = Math.min(min.w, availableW);
  }

  if (targetW === preferred.w) {
    return { h: preferred.h, w: targetW };
  }

  if (targetW < preferred.w) {
    if (!min) {
      return { h: preferred.h, w: targetW };
    }
    return {
      h: targetW <= min.w ? min.h : interpolateHeight(targetW, min, preferred),
      w: targetW,
    };
  }

  if (!max) {
    return { h: preferred.h, w: targetW };
  }
  return {
    h: targetW >= max.w ? max.h : interpolateHeight(targetW, preferred, max),
    w: targetW,
  };
}

/** 阅读序 id 列表（y 优先、x 其次、id 兜底）。 */
export function readingOrderIds(
  items: readonly { id: string; x: number; y: number }[]
): string[] {
  return [...items].sort(readingOrderCompare).map((e) => e.id);
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export interface SizeDeclaration {
  defaultSize?: MissionControlGridSize | undefined;
  layoutPriority?: MissionControlWidgetLayoutPriority | undefined;
  layoutProfiles?: readonly MissionControlWidgetLayoutProfile[] | undefined;
  maxSize?: MissionControlGridSize | undefined;
  minSize?: MissionControlGridSize | undefined;
}

function effectiveMin(
  decl: SizeDeclaration | undefined
): MissionControlGridSize {
  return decl?.minSize ?? HOST_MIN_WIDGET_SIZE;
}

function effectiveMax(
  decl: SizeDeclaration | undefined
): MissionControlGridSize {
  return decl?.maxSize ?? HOST_MAX_WIDGET_SIZE;
}

function effectiveDefault(
  decl: SizeDeclaration | undefined
): MissionControlGridSize {
  return decl?.defaultSize ?? HOST_DEFAULT_WIDGET_SIZE;
}

/** clamp w/h ∈ [min, max] */
export function clampSize(
  size: MissionControlGridSize,
  min: MissionControlGridSize,
  max: MissionControlGridSize
): MissionControlGridSize {
  return {
    h: Math.max(min.h, Math.min(max.h, size.h)),
    w: Math.max(min.w, Math.min(max.w, size.w)),
  };
}

/** clamp x ∈ [0, 12 - w]（historical params 越界时收敛而非报错）。 */
function clampX(x: number, w: number): number {
  return Math.max(0, Math.min(MISSION_CONTROL_GRID_COLS - w, x));
}

/**
 * entry → 布局条目。
 * 施加 clamp 语义：w/h ∈ [min, max]、x ∈ [0, 12-w]。
 * 同时下发 minW/minH/maxW/maxH 让布局引擎在源头限制调整尺寸。
 */
export function entryToLayoutItem(
  entry: GeometryEntry,
  decl: SizeDeclaration | undefined
): LayoutItem {
  const min = effectiveMin(decl);
  const max = effectiveMax(decl);
  const clamped = clampSize({ h: entry.h, w: entry.w }, min, max);
  return {
    h: clamped.h,
    i: entry.id,
    maxH: max.h,
    maxW: max.w,
    minH: min.h,
    minW: min.w,
    w: clamped.w,
    x: clampX(entry.x, clamped.w),
    y: entry.y,
  };
}

/**
 * 派生排布（k < 12 的窄容器）：基准 layout 按阅读序装入 k 列。
 * 纯函数、确定性、不修改输入；派生结果只用于渲染，绝不持久化。
 */
export function deriveLayout(
  items: readonly LayoutItem[],
  cols: number,
  options?: DeriveLayoutOptions
): LayoutItem[] {
  const availableCols = Math.max(1, Math.min(MISSION_CONTROL_GRID_COLS, cols));
  const sorted = [...items].sort((a, b) =>
    readingOrderCompare(
      { id: a.i, x: a.x, y: a.y },
      { id: b.i, x: b.x, y: b.y }
    )
  );
  const placed: LayoutItem[] = [];
  let cursor = { x: 0, y: 0 };

  for (const item of sorted) {
    const decl = options?.getSizeDeclaration?.(item.i);
    const responsive = resolveResponsiveGridSize(
      { h: item.h, w: item.w },
      decl,
      availableCols
    );
    const w = Math.max(1, Math.min(availableCols, responsive.w));
    const h = Math.max(1, responsive.h);
    const pos = findOrderedFit(placed, w, h, availableCols, cursor);
    const derived: LayoutItem = { ...item, h, w, x: pos.x, y: pos.y };
    if (item.minW !== undefined) {
      derived.minW = Math.min(item.minW, availableCols);
    }
    if (item.maxW !== undefined) {
      derived.maxW = Math.min(item.maxW, availableCols);
    }
    if (item.minH !== undefined) {
      derived.minH = item.minH;
    }
    if (item.maxH !== undefined) {
      derived.maxH = item.maxH;
    }
    placed.push(derived);
    cursor = { x: pos.x + w, y: pos.y };
  }

  return placed;
}

/**
 * 布局条目 → params entries。
 * 丢弃布局引擎瞬态字段（moved/static 等），只保留 id/x/y/w/h。
 */
export function layoutToEntries(
  layout: readonly LayoutItem[]
): GeometryEntry[] {
  return layout.map((item) => ({
    h: item.h,
    id: item.i,
    w: item.w,
    x: item.x,
    y: item.y,
  }));
}

/**
 * 派生模式下的编辑回写：纯挂载回声返回 null；真实 resize 或阅读序变化映射回 12 列基准。
 */
export function applyDerivedLayoutChange(
  basisEntries: readonly GeometryEntry[],
  prevDerived: readonly LayoutItem[],
  nextLayout: readonly LayoutItem[]
): GeometryEntry[] | null {
  const prevById = new Map(prevDerived.map((item) => [item.i, item]));
  let entries = basisEntries.map(({ h, id, w, x, y }) => ({ h, id, w, x, y }));
  let dirty = false;

  for (const item of nextLayout) {
    const prev = prevById.get(item.i);
    if (!prev || (item.w === prev.w && item.h === prev.h)) {
      continue;
    }
    entries = entries.map((entry) =>
      entry.id === item.i
        ? {
            ...entry,
            h: item.h === prev.h ? entry.h : item.h,
            w: item.w === prev.w ? entry.w : item.w,
          }
        : entry
    );
    dirty = true;
  }

  const prevOrder = readingOrderIds(
    prevDerived.map((item) => ({ id: item.i, x: item.x, y: item.y }))
  );
  const nextOrder = readingOrderIds(
    nextLayout.map((item) => ({ id: item.i, x: item.x, y: item.y }))
  );
  if (!sameOrder(prevOrder, nextOrder)) {
    entries = repackEntries(entries, nextOrder);
    dirty = true;
  }

  return dirty ? entries : null;
}

/** 按新的阅读序把基准条目重新装回 12 列。 */
export function repackEntries(
  entries: readonly GeometryEntry[],
  newOrderIds: readonly string[]
): GeometryEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const orderedIds = [
    ...newOrderIds.filter((id) => byId.has(id)),
    ...readingOrderIds(entries).filter((id) => !newOrderIds.includes(id)),
  ];
  const placed: GeometryEntry[] = [];
  let cursor = { x: 0, y: 0 };

  for (const id of orderedIds) {
    const entry = byId.get(id);
    if (!entry) {
      continue;
    }
    const w = Math.max(1, Math.min(MISSION_CONTROL_GRID_COLS, entry.w));
    const pos = findOrderedFit(
      placed,
      w,
      entry.h,
      MISSION_CONTROL_GRID_COLS,
      cursor
    );
    placed.push({ ...entry, w, x: pos.x, y: pos.y });
    cursor = { x: pos.x + w, y: pos.y };
  }

  return placed;
}

/**
 * 追加新条目：first-fit 算法——行优先、列其次扫描占用矩阵，
 * 找第一个能容纳 w×h 的 (x,y)；尺寸 = clamp(defaultSize)。
 */
export function appendEntry(
  entries: readonly { h: number; w: number; x: number; y: number }[],
  id: string,
  decl: SizeDeclaration | undefined
): GeometryEntry {
  const dflt = effectiveDefault(decl);
  const min = effectiveMin(decl);
  const max = effectiveMax(decl);
  const size = clampSize(dflt, min, max);

  const pos = findFirstFit(entries, size.w, size.h, MISSION_CONTROL_GRID_COLS);
  return { h: size.h, id, w: size.w, x: pos.x, y: pos.y };
}

/**
 * "添加组件"幽灵卡的落位：在当前基准布局里按 first-fit
 * 找一个 w×h 空位，返回格子坐标。与 appendEntry 的填缝语义一致——
 * 幽灵卡预览的就是"新卡大概会出现的位置"。
 */
export function findAddSlot(
  items: readonly { h: number; w: number; x: number; y: number }[],
  cols: number,
  w: number,
  h: number
): { x: number; y: number } {
  return findFirstFit(items, Math.min(w, cols), h, cols);
}

/**
 * 行优先 first-fit（带回填）：逐行扫描，在每行内从左到右找第一个能放下
 * w×h 的空位。用于新增和复制 widget；个位数 widget 场景，朴素实现足够。
 */
function findFirstFit(
  entries: readonly { h: number; w: number; x: number; y: number }[],
  w: number,
  h: number,
  cols: number
): { x: number; y: number } {
  if (entries.length === 0) {
    return { x: 0, y: 0 };
  }

  const maxBottom = entries.reduce((acc, e) => Math.max(acc, e.y + e.h), 0);

  for (let y = 0; y <= maxBottom; y++) {
    for (let x = 0; x <= cols - w; x++) {
      if (!overlapsAny(entries, x, y, w, h)) {
        return { x, y };
      }
    }
  }

  return { x: 0, y: maxBottom };
}

/**
 * 保序 first-fit：从当前游标之后寻找位置，禁止后续卡片回填到前序卡片之前的空洞。
 */
function findOrderedFit(
  entries: readonly { h: number; w: number; x: number; y: number }[],
  w: number,
  h: number,
  cols: number,
  cursor: { x: number; y: number }
): { x: number; y: number } {
  if (entries.length === 0) {
    return { x: 0, y: 0 };
  }

  const maxBottom = entries.reduce((acc, e) => Math.max(acc, e.y + e.h), 0);
  const maxY = Math.max(maxBottom, cursor.y) + 1;

  for (let y = cursor.y; y <= maxY; y++) {
    const startX = y === cursor.y ? cursor.x : 0;
    for (let x = startX; x <= cols - w; x++) {
      if (!overlapsAny(entries, x, y, w, h)) {
        return { x, y };
      }
    }
  }

  return { x: 0, y: maxBottom };
}

/** 检查候选矩形 (cx, cy, cw, ch) 是否与任何现有 entry 重叠。 */
function overlapsAny(
  entries: readonly { h: number; w: number; x: number; y: number }[],
  cx: number,
  cy: number,
  cw: number,
  ch: number
): boolean {
  for (const e of entries) {
    if (cx < e.x + e.w && cx + cw > e.x && cy < e.y + e.h && cy + ch > e.y) {
      return true;
    }
  }
  return false;
}
