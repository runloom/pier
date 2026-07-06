import type { DashboardGridSize } from "@shared/contracts/dashboard.ts";
import {
  DASHBOARD_GRID_COLS,
  HOST_DEFAULT_WIDGET_SIZE,
  HOST_MAX_WIDGET_SIZE,
  HOST_MIN_WIDGET_SIZE,
} from "@shared/contracts/dashboard.ts";
import type { LayoutItem } from "react-grid-layout";

/** 行高（px）——RGL rowHeight 参数。 */
export const ROW_HEIGHT = 88;

/** 网格间距（px）——RGL margin 参数。[水平, 垂直]。 */
export const MARGIN: [number, number] = [12, 12];

/** 格子像素宽——固定值，卡片尺寸与面板宽度解耦（HA 模型）。与 ROW_HEIGHT 对齐成方格。 */
export const CELL_WIDTH = 88;

/** 一格占位（格宽 + 水平间距）。 */
const GRID_UNIT = CELL_WIDTH + MARGIN[0];

/**
 * 内容区宽度 → 可用列数 k ∈ [1, 12]。
 * k 列网格像素宽 = k*88 + (k-1)*12 = k*100 - 12，故 k = floor((w + 12) / 100)。
 */
export function computeAvailableCols(contentWidth: number): number {
  const k = Math.floor((contentWidth + MARGIN[0]) / GRID_UNIT);
  return Math.max(1, Math.min(DASHBOARD_GRID_COLS, k));
}

/** k 列网格的像素总宽（containerPadding 为 [0,0] 时）。 */
export function gridPixelWidth(cols: number): number {
  return cols * GRID_UNIT - MARGIN[0];
}

/** 阅读序比较：y 优先、x 其次、id 兜底（脏数据同坐标时仍确定）。 */
function readingOrderCompare(
  a: { id: string; x: number; y: number },
  b: { id: string; x: number; y: number }
): number {
  return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
}

/**
 * 派生排布（k < 12 的窄容器）：基准 layout 按阅读序**保序装箱**进 k 列。
 * 每项的落位在阅读序 (y,x) 上严格晚于前一项，禁止回填——否则混合宽度时
 * 靠后的小卡会钻进靠前的空隙，显示顺序 ≠ 基准顺序（拖拽松手瞬间视觉对调）。
 * 代价是混合宽度下多留白（用户拍板接受）。
 * 不变量：输出 top-left 阅读序 == 输入阅读序。
 * 纯函数、确定性、不修改输入；派生结果只用于渲染，绝不持久化。
 */
export function deriveLayout(
  items: readonly LayoutItem[],
  cols: number
): LayoutItem[] {
  const sorted = [...items].sort((a, b) =>
    readingOrderCompare(
      { id: a.i, x: a.x, y: a.y },
      { id: b.i, x: b.x, y: b.y }
    )
  );
  const placed: LayoutItem[] = [];
  const cursor = { x: 0, y: 0 };
  for (const item of sorted) {
    const w = Math.min(item.w, cols);
    const pos = findOrderedFit(placed, w, item.h, cols, cursor);
    const derived: LayoutItem = { ...item, w, x: pos.x, y: pos.y };
    if (item.minW !== undefined) {
      derived.minW = Math.min(item.minW, cols);
    }
    if (item.maxW !== undefined) {
      derived.maxW = Math.min(item.maxW, cols);
    }
    placed.push(derived);
    cursor.x = pos.x + 1;
    cursor.y = pos.y;
  }
  return placed;
}

/** 阅读序 id 列表（y 优先、x 其次、id 兜底）。 */
export function readingOrderIds(
  items: readonly { id: string; x: number; y: number }[]
): string[] {
  return [...items].sort(readingOrderCompare).map((e) => e.id);
}

/** 比较两个 id 序列是否完全一致（长度与逐项顺序）。 */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * 派生模式拖拽的持久化语义：按新阅读序把基准条目**保序装箱**回 12 列。
 * 保留每项 w/h，只重算 x/y。禁止回填——基准阅读序必须精确等于新顺序，
 * 否则用户刚拖出的顺序会被回填的小卡打乱；代价是混合宽度下多留白（用户拍板）。
 * 已知代价：基准里刻意的留白会被压实（见设计文档 §5）。
 *
 * 保序输出可能带"上方整列空闲"的竖向空隙：全宽模式的 verticalCompactor 会
 * 把这类项上提并触发一次校正写回，属"越界收敛而非报错"的既有策略（派生模式
 * 用 noCompactor，不受影响）。
 */
export function repackEntries(
  entries: readonly {
    h: number;
    id: string;
    w: number;
    x: number;
    y: number;
  }[],
  orderIds: readonly string[]
): { h: number; id: string; w: number; x: number; y: number }[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const orderedIds = [
    ...orderIds.filter((id) => byId.has(id)),
    ...entries.map((e) => e.id).filter((id) => !orderIds.includes(id)),
  ];
  const placed: { h: number; id: string; w: number; x: number; y: number }[] =
    [];
  const cursor = { x: 0, y: 0 };
  for (const id of orderedIds) {
    const e = byId.get(id);
    if (!e) {
      continue;
    }
    const pos = findOrderedFit(placed, e.w, e.h, DASHBOARD_GRID_COLS, cursor);
    placed.push({ h: e.h, id: e.id, w: e.w, x: pos.x, y: pos.y });
    cursor.x = pos.x + 1;
    cursor.y = pos.y;
  }
  return placed;
}

/**
 * 派生模式 onLayoutChange 的持久化决策：对比传给 RGL 的派生布局与其回报，
 * 识别 (a) resize（w/h 差分直存基准）与 (b) 拖拽（阅读序变化重装基准）。
 * 无真实编辑（纯回声）返回 null——派生坐标绝不写回基准。
 *
 * 自愈语义：派生模式 resize 直存 w/h 可能让基准条目暂时重叠，回全宽后由
 * RGL compaction 收敛并触发一次校正写回，属"越界收敛而非报错"的既有策略。
 */
export function applyDerivedLayoutChange(
  basisEntries: readonly {
    h: number;
    id: string;
    w: number;
    x: number;
    y: number;
  }[],
  prevDerived: readonly LayoutItem[],
  nextLayout: readonly LayoutItem[]
): { h: number; id: string; w: number; x: number; y: number }[] | null {
  const prevById = new Map(prevDerived.map((l) => [l.i, l]));
  let entries: readonly {
    h: number;
    id: string;
    w: number;
    x: number;
    y: number;
  }[] = basisEntries;
  let dirty = false;

  for (const item of nextLayout) {
    const prev = prevById.get(item.i);
    if (prev && (item.w !== prev.w || item.h !== prev.h)) {
      // 按轴写回：只有用户真正动过的轴才覆盖基准。若整组写回，
      // 派生 clamp 过的宽（如基准 w=12 在 k=8 下为 8）会在仅改高度时
      // 被静默写进基准，回全宽后永久变窄。
      entries = entries.map((e) =>
        e.id === item.i
          ? {
              ...e,
              h: item.h === prev.h ? e.h : item.h,
              w: item.w === prev.w ? e.w : item.w,
            }
          : e
      );
      dirty = true;
    }
  }

  const prevOrder = readingOrderIds(
    prevDerived.map((l) => ({ id: l.i, x: l.x, y: l.y }))
  );
  const newOrder = readingOrderIds(
    nextLayout.map((l) => ({ id: l.i, x: l.x, y: l.y }))
  );
  if (!sameOrder(prevOrder, newOrder)) {
    entries = repackEntries(entries, newOrder);
    dirty = true;
  }

  return dirty ? [...entries] : null;
}

interface SizeDeclaration {
  defaultSize?: DashboardGridSize | undefined;
  maxSize?: DashboardGridSize | undefined;
  minSize?: DashboardGridSize | undefined;
}

function effectiveMin(decl: SizeDeclaration | undefined): DashboardGridSize {
  return decl?.minSize ?? HOST_MIN_WIDGET_SIZE;
}

function effectiveMax(decl: SizeDeclaration | undefined): DashboardGridSize {
  return decl?.maxSize ?? HOST_MAX_WIDGET_SIZE;
}

function effectiveDefault(
  decl: SizeDeclaration | undefined
): DashboardGridSize {
  return decl?.defaultSize ?? HOST_DEFAULT_WIDGET_SIZE;
}

/** clamp w/h ∈ [min, max] */
function clampSize(
  size: DashboardGridSize,
  min: DashboardGridSize,
  max: DashboardGridSize
): DashboardGridSize {
  return {
    h: Math.max(min.h, Math.min(max.h, size.h)),
    w: Math.max(min.w, Math.min(max.w, size.w)),
  };
}

/** clamp x ∈ [0, 12 - w]（historical params 越界时收敛而非报错）。 */
function clampX(x: number, w: number): number {
  return Math.max(0, Math.min(DASHBOARD_GRID_COLS - w, x));
}

/**
 * entry → RGL layout item。
 * 施加 clamp 语义：w/h ∈ [min, max]、x ∈ [0, 12-w]。
 * 同时下发 minW/minH/maxW/maxH 让 RGL 拖拽调整在源头受限。
 */
export function entryToLayoutItem(
  entry: { h: number; id: string; w: number; x: number; y: number },
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
 * RGL layout → params entries。
 * 丢弃 RGL 瞬态字段（moved/static 等），只保留 id/x/y/w/h。
 */
export function layoutToEntries(
  layout: readonly LayoutItem[]
): { h: number; id: string; w: number; x: number; y: number }[] {
  return layout.map((item) => ({
    h: item.h,
    id: item.i,
    w: item.w,
    x: item.x,
    y: item.y,
  }));
}

/**
 * 追加新条目：first-fit 算法——行优先、列其次扫描占用矩阵，
 * 找第一个能容纳 w×h 的 (x,y)；尺寸 = clamp(defaultSize)。
 */
export function appendEntry(
  entries: readonly { h: number; w: number; x: number; y: number }[],
  id: string,
  decl: SizeDeclaration | undefined
): { h: number; id: string; w: number; x: number; y: number } {
  const dflt = effectiveDefault(decl);
  const min = effectiveMin(decl);
  const max = effectiveMax(decl);
  const size = clampSize(dflt, min, max);

  const pos = findFirstFit(entries, size.w, size.h, DASHBOARD_GRID_COLS);
  return { h: size.h, id, w: size.w, x: pos.x, y: pos.y };
}

/**
 * "添加组件"幽灵卡的落位：在当前显示布局（基准或派生）里按 first-fit
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
 * 保序放置扫描：候选位置按阅读序 (y,x) 从游标（上一项落位的下一格）开始，
 * 取第一个不与已放置项重叠且 x+w ≤ cols 的位置。游标随每次落位推进，
 * 保证输出 top-left 阅读序严格递增（禁止回填到游标之前的空隙）。
 */
function findOrderedFit(
  entries: readonly { h: number; w: number; x: number; y: number }[],
  w: number,
  h: number,
  cols: number,
  cursor: { x: number; y: number }
): { x: number; y: number } {
  const maxBottom = entries.reduce((acc, e) => Math.max(acc, e.y + e.h), 0);
  // 扫描上界：max(maxBottom, cursor.y) + 1 行必然整行空闲且从 x=0 起扫，
  // w ≤ cols（调用方已 clamp）时该行必能容纳，循环保证命中。
  const maxY = Math.max(maxBottom, cursor.y) + 1;
  for (let y = cursor.y; y <= maxY; y++) {
    const startX = y === cursor.y ? cursor.x : 0;
    for (let x = startX; x <= cols - w; x++) {
      if (!overlapsAny(entries, x, y, w, h)) {
        return { x, y };
      }
    }
  }
  // 理论不可达（maxY 行必命中），为类型完整性兜底
  return { x: 0, y: maxY };
}

/**
 * 行优先 first-fit（带回填）：逐行扫描，在每行内从左到右找第一个能放下
 * w×h 的空位。仅供 appendEntry 用——新增 widget 填缝是好行为；派生/重排
 * 装箱走 findOrderedFit（保序语义）。个位数 widget 场景，朴素实现足够。
 */
function findFirstFit(
  entries: readonly { h: number; w: number; x: number; y: number }[],
  w: number,
  h: number,
  cols: number
): { x: number; y: number } {
  // 空网格直接 (0,0)
  if (entries.length === 0) {
    return { x: 0, y: 0 };
  }

  const maxBottom = entries.reduce((acc, e) => Math.max(acc, e.y + e.h), 0);

  // 逐行扫描到 maxBottom（含）——最坏情况放在底部新行
  for (let y = 0; y <= maxBottom; y++) {
    for (let x = 0; x <= cols - w; x++) {
      if (!overlapsAny(entries, x, y, w, h)) {
        return { x, y };
      }
    }
  }

  // 所有行都放不下，兜底到底部新行
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
    // 两矩形不重叠 ⟺ 一方完全在另一方的左/右/上/下
    if (cx < e.x + e.w && cx + cw > e.x && cy < e.y + e.h && cy + ch > e.y) {
      return true;
    }
  }
  return false;
}
