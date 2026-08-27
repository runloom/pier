import type { ParsedItemCacheEntry, PierDiffViewItem } from "./items.ts";
import type { DiffViewScrollOptions } from "./scroll-behavior.ts";

export interface PierDiffViewAnchor {
  readonly id: string;
  readonly offset: number;
}

export interface DiffViewCollapsedItemState {
  readonly collapsed: boolean;
  readonly revision: number;
}

export type DiffViewRenderItemIdentity = Pick<
  ParsedItemCacheEntry,
  "cacheKey" | "version"
>;

export interface PierDiffViewLineSelection {
  readonly id: string;
  readonly range: {
    readonly end: number;
    readonly endSide?: "additions" | "deletions";
    readonly side?: "additions" | "deletions";
    readonly start: number;
  };
}

export interface PierDiffViewUpdateOptions {
  /**
   * 显式 true 时在 updateItems 后做一次 item 级 restore。
   * 默认 false：正文高度变化交给 Pierre CodeView 内置行级 scroll anchoring
   *（getScrollAnchor → resolveAnchoredScrollTop），外层勿钉 raw scrollTop。
   */
  readonly preserveAnchor?: boolean;
}

export interface PierDiffViewPointerLineHit {
  readonly fromNumberColumn: boolean;
  readonly id: string;
  readonly lineNumber: number;
  readonly side: "additions" | "deletions";
}

export interface PierDiffViewHandle {
  /** 捕获指定已渲染 item 相对视口顶部的位置；未渲染时返回 null。 */
  captureItemAnchor?(id: string): PierDiffViewAnchor | null;
  captureTopAnchor(): PierDiffViewAnchor | null;
  /** 当前已挂载槽位的实测高度，供上层在正文回收后复用稳定估高。 */
  getRenderedItemHeights?(): ReadonlyMap<string, number>;
  /** 当前 CodeView 容器 raw scrollTop；无容器时 null。 */
  getScrollTop(): number | null;
  /**
   * Pierre 行选区（item id + range）；无选区时 null。
   * 供 partial stage 映射到 hunk index。
   */
  getSelectedLines(): PierDiffViewLineSelection | null;
  /** Pierre 行选区文本；无选区时返回空串。 */
  getSelectedText(): string;
  /**
   * 可视布局指纹。除视口几何外还包含目标项的实测位置，避免前序项一增一减、
   * 总高度不变时把已经移动的目标误判为稳定。
   */
  getViewportLayoutKey(targetItemId?: string): string | null;
  isItemVisible(id: string, cacheKey?: string): boolean;
  /**
   * CodeView 已进入可测量布局，导航才可提交 scrollTo。
   * Dockview 隐藏标签页会保留实例，但容器尺寸为 0。
   */
  isViewportReady(): boolean;
  /**
   * 等待可视布局指纹连续稳定若干帧。帧调度属于 CodeView 适配层，
   * renderer 只提交语义导航事务。
   */
  requestViewportLayoutSettled(
    targetItemId: string,
    stableFrames: number,
    callback: () => void
  ): () => void;
  /**
   * 从 pointer / contextmenu 事件解析行命中（含 shadow composedPath）。
   * 供宿主右键「跳转到源码」落到对应行。
   */
  resolvePointerLineHit(
    event: Pick<PointerEvent, "clientX" | "clientY" | "composedPath" | "target">
  ): PierDiffViewPointerLineHit | null;
  restoreAnchor(anchor: PierDiffViewAnchor): boolean;
  /**
   * 定位到 item。behavior 缺省对齐 DiffsHub：
   * 新建/刚展开 → instant；已在场 → smooth。
   * 调用方可强制 `instant` | `smooth`。
   *
   * 注意：不可用 getTopForItem 硬写 scrollTop「纠正」——估高错误时 top 与
   * scrollTo 同源，会把错误落点钉死（表现为首次点树偏、再点才准）。
   */
  scrollToItem(id: string, options?: DiffViewScrollOptions): boolean;
  /**
   * 定位到 item 内的某一行（评论 reveal、行级跳转）。
   *
   * - side 缺省按 additions；expandCollapsed 缺省 true（对齐 scrollToItem：
   *   折叠 item 先展开才能定位行）。
   * - behavior 缺省 smooth；align 固定 center（行级居中可读，区别于
   *   scrollToItem 的 start 顶部对齐）。
   * - instant 与 scrollToItem 一样经 microtask layout flush，避免先画出
   *   文件头再跳行。
   * - 调用方负责评论 target.side（"old"|"new"）→ diff-view side
   *   （"deletions"|"additions"）的映射。
   */
  scrollToLine(
    id: string,
    lineNumber: number,
    side?: "additions" | "deletions",
    options?: DiffViewScrollOptions
  ): boolean;
  /** 全选当前（或最近）diff/file item 的全部行。 */
  selectAll(): boolean;
  /**
   * 折叠/展开全部 diff item，并记为视图级缺省：此后水合的正文与新进投影窗口的
   * 槽位一并继承，直到下一次调用或用户单独翻转该文件。
   * 展开不作用于 estimate / notice 等 0 行正文槽（展开只会得到空壳）。
   */
  setAllCollapsed(collapsed: boolean): void;
  /** 写回 raw scrollTop（菜单 Freeze 用；禁止用 item scrollTo 代替）。 */
  setScrollTop(scrollTop: number): boolean;
  updateItems(
    items: readonly PierDiffViewItem[],
    options?: PierDiffViewUpdateOptions
  ): boolean;
}
