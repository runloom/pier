/**
 * Diff 布局施加层：把 geometry 的 H/S 写进 Pierre CodeView 布局字段。
 *
 * 公式只在 geometry.ts；本文件禁止自有高度常量或平行估高。
 * 折叠全部 / 单槽折叠：全表按意图写 H 并钉 S，禁止依赖滚动 remeasure 收敛。
 *
 * 钩子策略（性能）：
 * - recomputeLayout 后：全表 apply（结构/折叠变更）
 * - computeRenderRangeAndEmit：collapse-all 全表 apply+pin；
 *   普通滚动禁止全表 apply。钉回赶在 Pierre syncContainerHeight / clamp 之前
 *   （仅 logical scrollHeight 变化时标脏；容器高用分页值）
 */
import {
  DIFF_ITEM_GAP_PX,
  type DiffMetrics,
  slotVirtualHeight,
  totalScrollHeight,
} from "./geometry.ts";

const PATCHED = new WeakSet<object>();
/** Pierre CodeView `SCROLL_REBASE_CONTAINER_HEIGHT` / `THRESHOLD`。 */
const PIERRE_PAGED_SCROLL_HEIGHT_PX = 12e6;
const PIERRE_PAGED_SCROLL_THRESHOLD_PX = 11e6;

interface CodeViewLayoutItem {
  height: number;
  instance: {
    currentCollapsed?: boolean;
    height: number;
    layoutDirty?: boolean;
    top?: number;
  };
  item?: {
    collapsed?: boolean;
    fileDiff?: { cacheKey?: string };
    id?: string;
  };
  top: number;
  type?: string;
}

interface CodeViewLike {
  computeRenderRangeAndEmit?: (timestamp?: number) => void;
  container?: HTMLElement | null;
  containerHeight?: number;
  getHeight?: () => number;
  getLayout?: () => {
    gap: number;
    paddingBottom?: number;
    paddingTop?: number;
  };
  getPagedScrollHeight?: () => number;
  items?: CodeViewLayoutItem[];
  layoutDirtyIndex?: number | undefined;
  pendingLayoutReset?: unknown;
  recomputeLayout?: (startIndex?: number, reset?: unknown) => void;
  render?: (immediate?: boolean) => void;
  scrollDirty?: boolean;
  scrollHeight?: number;
  syncContainerHeight?: () => void;
}

export interface DiffVirtualHeightOptions {
  /**
   * 视图级「折叠全部」意图。
   * **高度权威是 isUserCollapsed**（已含缺省 + 显式展开覆盖）。
   * 本标志仅用于：无 id 记录的兜底、以及滚动 emit 期间是否启用全表守卫。
   */
  readonly isCollapseAllIntent?: () => boolean;
  readonly isUserCollapsed: (itemId: string) => boolean;
  readonly metrics: DiffMetrics;
}

export function isEstimateCacheKey(cacheKey: string | undefined): boolean {
  return typeof cacheKey === "string" && cacheKey.startsWith("estimate:");
}

/**
 * 单槽目标虚拟高度。
 * @returns null = 不覆盖（用 Pierre 原文高度，仅 loaded 展开）
 *
 * 折叠优先级（与 isUserCollapsedItem 一致）：
 * - userCollapsed（含「折叠全部」缺省 + 显式收起）→ header
 * - 显式展开（userCollapsed=false）即使全局仍是折叠全部 → 不得钉 header
 * - estimate 未用户折 → 骨架槽高（头 + 5 条，不按 numstat 占位）
 * - loaded 技术 collapsed → header
 * - loaded 展开 → null（Pierre 量正文）
 */
export function resolveItemVirtualHeight(options: {
  readonly collapsed: boolean;
  readonly contentLines?: number;
  readonly isEstimate: boolean;
  readonly metrics: DiffMetrics;
  readonly userCollapsed: boolean;
}): number | null {
  if (options.userCollapsed) {
    return slotVirtualHeight({
      collapsed: true,
      kind: options.isEstimate ? "estimate" : "loaded",
      metrics: options.metrics,
    });
  }
  if (options.isEstimate) {
    return slotVirtualHeight({
      collapsed: false,
      kind: "estimate",
      metrics: options.metrics,
    });
  }
  if (options.collapsed) {
    return slotVirtualHeight({
      collapsed: true,
      kind: "loaded",
      metrics: options.metrics,
    });
  }
  return null;
}

/**
 * 校正 CodeView 全表高度 / top / scrollHeight。
 * 折叠意图下会改写**每一个**槽，不只是可见窗。
 */
export function applyDiffVirtualHeights(
  codeView: unknown,
  options: DiffVirtualHeightOptions
): boolean {
  if (!(isCodeViewLike(codeView) && Array.isArray(codeView.items))) {
    return false;
  }
  const items = codeView.items;
  if (items.length === 0) {
    return false;
  }
  const collapseAll = options.isCollapseAllIntent?.() === true;
  const gap = codeView.getLayout?.().gap ?? options.metrics.gap;
  let runningTop = 0;
  let changed = false;

  for (let index = 0; index < items.length; index += 1) {
    const record = items[index];
    if (record == null) {
      continue;
    }
    const cacheKey = record.item?.fileDiff?.cacheKey;
    const itemId = record.item?.id;
    const isEstimate = isEstimateCacheKey(cacheKey);
    const collapsed = record.item?.collapsed === true;
    // 无 id 时：折叠全部意图视为用户折；否则不猜
    const userCollapsed =
      typeof itemId === "string"
        ? options.isUserCollapsed(itemId)
        : collapseAll;
    let target: number | null = null;
    if (typeof itemId === "string") {
      target = resolveItemVirtualHeight({
        collapsed,
        isEstimate,
        metrics: options.metrics,
        userCollapsed,
      });
    } else if (userCollapsed) {
      target = slotVirtualHeight({
        collapsed: true,
        kind: "loaded",
        metrics: options.metrics,
      });
    }

    // 折叠标志：只跟用户意图 / 技术 collapsed 对齐，禁止 collapseAll 压过显式展开
    if (userCollapsed) {
      if (record.item && record.item.collapsed !== true) {
        record.item = { ...record.item, collapsed: true };
        changed = true;
      }
      if (record.instance.currentCollapsed !== true) {
        record.instance.currentCollapsed = true;
        changed = true;
      }
    } else if (!isEstimate && collapsed) {
      if (record.instance.currentCollapsed !== true) {
        record.instance.currentCollapsed = true;
        changed = true;
      }
    } else if (
      record.item?.collapsed !== true &&
      record.instance.currentCollapsed === true
    ) {
      // 用户展开：清掉实例上滞留的 collapsed，并标脏以便 remeasure 正文
      record.instance.currentCollapsed = false;
      record.instance.layoutDirty = true;
      changed = true;
    }

    if (target != null && Math.abs(record.height - target) > 0.5) {
      record.height = target;
      record.instance.height = target;
      // 折叠钉高：阻止 computeApproximateSize 因 layoutDirty=false 直接 return 旧高
      if (userCollapsed || (collapsed && !isEstimate)) {
        record.instance.layoutDirty = false;
      }
      changed = true;
    }

    if (Math.abs(record.top - runningTop) > 0.5) {
      changed = true;
    }
    record.top = runningTop;
    record.instance.top = runningTop;
    runningTop += record.height;
    if (index < items.length - 1) {
      runningTop += gap;
    }
  }

  if (
    typeof codeView.scrollHeight !== "number" ||
    Math.abs(codeView.scrollHeight - runningTop) > 0.5
  ) {
    codeView.scrollHeight = runningTop;
    codeView.scrollDirty = true;
    changed = true;
  }

  if (changed) {
    pinCodeViewScrollHeight(codeView, options.metrics.gap);
  }
  return changed;
}

export function reconcileDiffVirtualHeights(
  codeView: unknown,
  options: DiffVirtualHeightOptions
): boolean {
  if (!isCodeViewLike(codeView)) {
    return false;
  }
  // 清掉排队中的脏区间，避免随后 rAF 只从中间 index 重算、前面虚高残留
  codeView.layoutDirtyIndex = undefined;
  codeView.pendingLayoutReset = undefined;

  if (typeof codeView.recomputeLayout === "function") {
    try {
      codeView.recomputeLayout(0, {
        includeEstimatedDiffHeights: true,
        resetDiffLayoutCache: true,
      });
    } catch {
      // double 无完整签名
    }
  }

  // 再清一次：recompute 过程中 item 更新可能又置脏
  codeView.layoutDirtyIndex = undefined;
  codeView.pendingLayoutReset = undefined;

  applyDiffVirtualHeights(codeView, options);
  pinCodeViewScrollHeight(codeView, options.metrics.gap);

  if (typeof codeView.render === "function") {
    try {
      // immediate：dequeue 掉折叠循环里 queue 的 rAF，立刻用钉死后的高度渲染
      codeView.render(true);
    } catch {
      // unmount / 测试 double
    }
    codeView.layoutDirtyIndex = undefined;
    codeView.pendingLayoutReset = undefined;
    applyDiffVirtualHeights(codeView, options);
    pinCodeViewScrollHeight(codeView, options.metrics.gap);
  }
  return true;
}

/**
 * 逻辑总高钉成 Σ items[].height；容器高走 Pierre 分页值。
 * 只在逻辑总高变化时标脏，避免与分页容器每帧对打。
 */
export function pinCodeViewScrollHeight(
  codeView: unknown,
  gap: number = DIFF_ITEM_GAP_PX
): boolean {
  if (!(isCodeViewLike(codeView) && Array.isArray(codeView.items))) {
    return false;
  }
  const items = codeView.items;
  if (items.length === 0) {
    if (codeView.scrollHeight !== 0) {
      codeView.scrollHeight = 0;
      codeView.scrollDirty = true;
      if (codeView.container != null) {
        codeView.container.style.height = "0px";
        codeView.containerHeight = 0;
      }
      return true;
    }
    return false;
  }
  const layoutGap = codeView.getLayout?.().gap ?? gap;
  const heights = items.map((item) => item?.height ?? 0);
  const total = totalScrollHeight(heights, layoutGap);
  const logicalChanged =
    typeof codeView.scrollHeight !== "number" ||
    Math.abs(codeView.scrollHeight - total) > 0.5;
  if (logicalChanged) {
    codeView.scrollHeight = total;
    codeView.scrollDirty = true;
  }
  const paged = pagedContainerHeight(codeView, total);
  const containerChanged =
    codeView.container != null &&
    (codeView.containerHeight !== paged ||
      codeView.container.style.height !== `${paged}px`);
  if (containerChanged && codeView.container != null) {
    codeView.container.style.height = `${paged}px`;
    codeView.containerHeight = paged;
  }
  return logicalChanged || containerChanged;
}

/**
 * 安装 recomputeLayout + computeRenderRangeAndEmit 钩子。
 * - recomputeLayout 后：全表 apply（结构/折叠变更真源）
 * - emit：collapse-all 全表 apply+pin；普通滚动禁止全表 apply。
 *   先包 syncContainerHeight，避免同一拍 clamp 把 scrollTop 收成 0。
 * 钩子只调用 geometry 公式，不引入第二套高度语义。
 */
export function installDiffVirtualHeightReconciler(
  codeView: unknown,
  optionsRef: { current: DiffVirtualHeightOptions }
): void {
  if (!isCodeViewLike(codeView)) {
    return;
  }
  if (PATCHED.has(codeView)) {
    return;
  }
  PATCHED.add(codeView);

  if (typeof codeView.recomputeLayout === "function") {
    const originalRecompute = codeView.recomputeLayout.bind(codeView);
    codeView.recomputeLayout = (startIndex?: number, reset?: unknown) => {
      originalRecompute(startIndex, reset);
      applyDiffVirtualHeights(codeView, optionsRef.current);
    };
  }

  if (typeof codeView.syncContainerHeight === "function") {
    const originalSync = codeView.syncContainerHeight.bind(codeView);
    codeView.syncContainerHeight = () => {
      pinCodeViewScrollHeight(codeView, optionsRef.current.metrics.gap);
      originalSync();
    };
  }

  if (typeof codeView.computeRenderRangeAndEmit === "function") {
    const originalEmit = codeView.computeRenderRangeAndEmit.bind(codeView);
    codeView.computeRenderRangeAndEmit = (timestamp?: number) => {
      originalEmit(timestamp);
      const options = optionsRef.current;
      if (options.isCollapseAllIntent?.() === true) {
        // 折叠全部：每帧全表钉高，盖住 Pierre 对可见窗的局部重算。
        applyDiffVirtualHeights(codeView, options);
        pinCodeViewScrollHeight(codeView, options.metrics.gap);
        return;
      }
      // 普通滚动：禁止全表 apply。总高若被可见窗改写，按已钉槽高 pin。
      pinCodeViewScrollHeight(codeView, options.metrics.gap);
    };
  }

  applyDiffVirtualHeights(codeView, optionsRef.current);
}

function pagedContainerHeight(codeView: CodeViewLike, total: number): number {
  if (typeof codeView.getPagedScrollHeight === "function") {
    return codeView.getPagedScrollHeight();
  }
  const viewport =
    typeof codeView.getHeight === "function" ? codeView.getHeight() : 0;
  const layout = codeView.getLayout?.();
  const paddingTop = layout?.paddingTop ?? 0;
  const paddingBottom = layout?.paddingBottom ?? 0;
  const maxScrollTop = Math.max(
    paddingTop + total + paddingBottom - viewport,
    0
  );
  if (maxScrollTop > PIERRE_PAGED_SCROLL_THRESHOLD_PX) {
    return Math.min(total, PIERRE_PAGED_SCROLL_HEIGHT_PX);
  }
  return total;
}

function isCodeViewLike(value: unknown): value is CodeViewLike {
  return value != null && typeof value === "object";
}
