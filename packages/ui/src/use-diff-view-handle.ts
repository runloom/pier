import type { CodeViewHandle } from "@pierre/diffs/react";
import { type Ref, type RefObject, useImperativeHandle, useMemo } from "react";
import type { PierHunkAnnotationMetadata } from "./diff-view-hunk-actions.tsx";
import { acceptDiffViewItem } from "./diff-view-item-sync.ts";
import type { PierDiffCodeViewItem } from "./diff-view-items.ts";
import {
  type ParsedItemCacheEntry,
  type PierDiffViewItem,
  toCodeViewItem,
} from "./diff-view-items.ts";
import { isRenderedItemVisible } from "./diff-view-render-watchdog.ts";
import {
  fullSelectionRangeForCodeViewItem,
  selectedLinesTextFromCodeViewItem,
} from "./diff-view-selection-text.ts";

export { acceptDiffViewItem } from "./diff-view-item-sync.ts";

export interface PierDiffViewAnchor {
  readonly id: string;
  readonly offset: number;
}

export interface PierDiffViewLineSelection {
  readonly id: string;
  readonly range: {
    readonly end: number;
    readonly endSide?: "additions" | "deletions";
    readonly side?: "additions" | "deletions";
    readonly start: number;
  };
}

export interface PierDiffViewHandle {
  captureTopAnchor(): PierDiffViewAnchor | null;
  /** 当前 CodeView 容器 raw scrollTop；无容器时 null。 */
  getScrollTop(): number | null;
  /**
   * Pierre 行选区（item id + range）；无选区时 null。
   * 供 partial stage 映射到 hunk index。
   */
  getSelectedLines(): PierDiffViewLineSelection | null;
  /** Pierre 行选区文本；无选区时返回空串。 */
  getSelectedText(): string;
  isItemVisible(id: string, cacheKey?: string): boolean;
  restoreAnchor(anchor: PierDiffViewAnchor): boolean;
  /**
   * 定位到 item。behavior 缺省对齐 DiffsHub：
   * 新建/刚展开 → instant；已在场 → smooth。
   * 调用方可强制 `instant` | `smooth`。
   *
   * 注意：不可用 getTopForItem 硬写 scrollTop「纠正」——估高错误时 top 与
   * scrollTo 同源，会把错误落点钉死（表现为首次点树偏、再点才准）。
   */
  scrollToItem(
    id: string,
    options?: { readonly behavior?: "instant" | "smooth" }
  ): boolean;
  /** 全选当前（或最近）diff/file item 的全部行。 */
  selectAll(): boolean;
  /** 折叠/展开当前拓扑内的全部 diff item。 */
  setAllCollapsed(collapsed: boolean): void;
  /** 写回 raw scrollTop（菜单 Freeze 用；禁止用 item scrollTo 代替）。 */
  setScrollTop(scrollTop: number): boolean;
  updateItems(
    items: readonly PierDiffViewItem[],
    options?: PierDiffViewUpdateOptions
  ): boolean;
}

export interface PierDiffViewUpdateOptions {
  /**
   * 显式 true 时在 updateItems 后做一次 item 级 restore。
   * 默认 false：正文高度变化交给 Pierre CodeView 内置行级 scroll anchoring
   *（getScrollAnchor → resolveAnchoredScrollTop），外层勿钉 raw scrollTop。
   */
  readonly preserveAnchor?: boolean;
}

/**
 * CodeView 真实滚动节点可能是 getContainerElement，也可能是带 overflow 的祖先/自身。
 * 取 scrollHeight 明显大于 clientHeight 且 scrollTop 可写的那个。
 */
function resolveCodeViewScrollElement(
  start: HTMLElement | null | undefined
): HTMLElement | null {
  if (!start) {
    return null;
  }
  let best: HTMLElement | null = null;
  let bestSlack = 0;
  let node: HTMLElement | null = start;
  for (let depth = 0; node && depth < 6; depth += 1) {
    const slack = node.scrollHeight - node.clientHeight;
    if (slack > bestSlack) {
      best = node;
      bestSlack = slack;
    }
    node = node.parentElement;
  }
  return best ?? start;
}

export interface DiffViewCollapsedItemState {
  readonly collapsed: boolean;
  readonly revision: number;
}

export type DiffViewRenderItemIdentity = Pick<
  ParsedItemCacheEntry,
  "cacheKey" | "version"
>;

interface UseDiffViewHandleOptions {
  readonly appliedItemsRef: RefObject<{
    readonly key: string;
    readonly items: Map<string, PierDiffCodeViewItem>;
  } | null>;
  readonly auditVisibleItems: () => void;
  readonly bumpItemEpoch: () => void;
  readonly codeViewRef: RefObject<CodeViewHandle<PierHunkAnnotationMetadata> | null>;
  readonly collapsedItemsRef: RefObject<
    Map<string, DiffViewCollapsedItemState>
  >;
  readonly expectItemRender: (id: string, version: number | undefined) => void;
  readonly firstLayoutItemIdsRef: RefObject<Set<string>>;
  readonly itemErrorIdsRef: RefObject<Set<string>>;
  readonly onItemErrorRef: RefObject<
    ((id: string, error: Error | null) => void) | undefined
  >;
  readonly parsedItemIndexesRef: RefObject<Map<string, number>>;
  readonly parsedItemListRef: RefObject<PierDiffCodeViewItem[]>;
  readonly parsedItemsRef: RefObject<Map<string, ParsedItemCacheEntry>>;
  readonly ref: Ref<PierDiffViewHandle> | undefined;
  readonly renderItemIdentitiesRef: RefObject<
    Map<string, DiffViewRenderItemIdentity>
  >;
  readonly scheduleRenderWindowReport: () => void;
  /** 右键前可能已清空 live selection；优先返回最近一次有效行选区文本。 */
  readonly selectedTextRef: RefObject<string>;
  readonly setItemCollapsed: (
    id: string,
    collapsed: boolean,
    preserveTopAnchor?: boolean
  ) => boolean;
}

export function useDiffViewHandle({
  appliedItemsRef,
  auditVisibleItems,
  bumpItemEpoch,
  codeViewRef,
  collapsedItemsRef,
  expectItemRender,
  firstLayoutItemIdsRef,
  itemErrorIdsRef,
  onItemErrorRef,
  parsedItemIndexesRef,
  parsedItemListRef,
  parsedItemsRef,
  ref,
  renderItemIdentitiesRef,
  scheduleRenderWindowReport,
  selectedTextRef,
  setItemCollapsed,
}: UseDiffViewHandleOptions): void {
  const handle = useMemo(
    () =>
      createDiffViewHandle({
        appliedItemsRef,
        auditVisibleItems,
        bumpItemEpoch,
        codeViewRef,
        collapsedItemsRef,
        expectItemRender,
        firstLayoutItemIdsRef,
        itemErrorIdsRef,
        onItemErrorRef,
        parsedItemIndexesRef,
        parsedItemListRef,
        parsedItemsRef,
        renderItemIdentitiesRef,
        scheduleRenderWindowReport,
        selectedTextRef,
        setItemCollapsed,
      }),
    [
      appliedItemsRef,
      auditVisibleItems,
      bumpItemEpoch,
      codeViewRef,
      collapsedItemsRef,
      expectItemRender,
      firstLayoutItemIdsRef,
      itemErrorIdsRef,
      onItemErrorRef,
      parsedItemIndexesRef,
      parsedItemListRef,
      parsedItemsRef,
      renderItemIdentitiesRef,
      scheduleRenderWindowReport,
      selectedTextRef,
      setItemCollapsed,
    ]
  );
  useImperativeHandle(ref, () => handle, [handle]);
}

function createDiffViewHandle({
  appliedItemsRef,
  auditVisibleItems,
  bumpItemEpoch,
  codeViewRef,
  collapsedItemsRef,
  expectItemRender,
  firstLayoutItemIdsRef,
  itemErrorIdsRef,
  onItemErrorRef,
  parsedItemIndexesRef,
  parsedItemListRef,
  parsedItemsRef,
  renderItemIdentitiesRef,
  scheduleRenderWindowReport,
  selectedTextRef,
  setItemCollapsed,
}: Omit<UseDiffViewHandleOptions, "ref">): PierDiffViewHandle {
  const resolveScrollContainer = (): HTMLElement | null =>
    resolveCodeViewScrollElement(
      codeViewRef.current?.getInstance()?.getContainerElement()
    );
  const captureTopAnchor = (): PierDiffViewAnchor | null => {
    const viewer = codeViewRef.current?.getInstance();
    const container = viewer?.getContainerElement();
    const rendered = viewer?.getRenderedItems() ?? [];
    if (!(viewer && container && rendered.length > 0)) {
      return null;
    }
    const scrollTop = container.scrollTop;
    let candidate = rendered[0];
    for (const item of rendered) {
      const top = viewer.getLocalTopForInstance(item.instance);
      if (top > scrollTop) {
        break;
      }
      candidate = item;
    }
    if (!candidate) {
      return null;
    }
    return {
      id: candidate.id,
      offset: viewer.getLocalTopForInstance(candidate.instance) - scrollTop,
    };
  };
  const restoreAnchor = (anchor: PierDiffViewAnchor): boolean => {
    const viewer = codeViewRef.current;
    if (!viewer?.getItem(anchor.id)) {
      return false;
    }
    viewer.scrollTo({
      align: "start",
      behavior: "instant",
      id: anchor.id,
      offset: anchor.offset,
      type: "item",
    });
    return true;
  };
  return {
    captureTopAnchor(): PierDiffViewAnchor | null {
      return captureTopAnchor();
    },
    getScrollTop(): number | null {
      const container = resolveScrollContainer();
      return container ? container.scrollTop : null;
    },
    getSelectedLines(): PierDiffViewLineSelection | null {
      const selection = codeViewRef.current?.getSelectedLines();
      if (!selection) {
        return null;
      }
      return {
        id: selection.id,
        range: {
          end: selection.range.end,
          ...(selection.range.endSide === undefined
            ? {}
            : { endSide: selection.range.endSide }),
          ...(selection.range.side === undefined
            ? {}
            : { side: selection.range.side }),
          start: selection.range.start,
        },
      };
    },
    getSelectedText(): string {
      const viewer = codeViewRef.current;
      const selection = viewer?.getSelectedLines();
      if (!selection) {
        // live 选区已空：清掉粘性快照，避免幽灵剪贴板串到其它面板。
        selectedTextRef.current = "";
        return "";
      }
      const item =
        viewer?.getItem(selection.id) ??
        appliedItemsRef.current?.items.get(selection.id) ??
        parsedItemsRef.current.get(selection.id)?.item;
      const fromModel = selectedLinesTextFromCodeViewItem(
        item,
        selection.range
      );
      selectedTextRef.current = fromModel;
      return fromModel;
    },

    isItemVisible(id: string, cacheKey?: string): boolean {
      const viewer = codeViewRef.current?.getInstance();
      const identity = renderItemIdentitiesRef.current.get(id);
      // cacheKey 仅作可选校验；identity 未建时仍可用 DOM 判可见（首点导航）
      if (identity && cacheKey && identity.cacheKey !== cacheKey) {
        return false;
      }
      const rendered = viewer?.getRenderedItems() ?? [];
      if (rendered.length === 0) {
        return false;
      }
      // 无 identity 时不绑 version，只要 DOM 在视口
      return isRenderedItemVisible(
        viewer?.getContainerElement(),
        rendered,
        id,
        identity?.version
      );
    },
    restoreAnchor(anchor: PierDiffViewAnchor): boolean {
      return restoreAnchor(anchor);
    },
    setScrollTop(scrollTop: number): boolean {
      const container = resolveScrollContainer();
      if (!container) {
        return false;
      }
      container.scrollTop = scrollTop;
      return true;
    },
    scrollToItem(
      id: string,
      options?: { readonly behavior?: "instant" | "smooth" }
    ): boolean {
      const viewer = codeViewRef.current;
      const item = viewer?.getItem(id);
      if (!(viewer && item)) {
        return false;
      }
      // 显式 behavior 优先（树导航主路径恒传 smooth）。
      // 未指定时：新建/刚展开 instant，已在场 smooth（与 DiffsHub 默认一致）。
      const wasCollapsed = item.collapsed === true;
      const firstLayout =
        wasCollapsed ||
        firstLayoutItemIdsRef.current.has(id) ||
        renderItemIdentitiesRef.current.has(id) === false;
      if (wasCollapsed && !setItemCollapsed(id, false, false)) {
        return false;
      }
      const behavior =
        options?.behavior ?? (firstLayout ? "instant" : "smooth");
      viewer.scrollTo({
        align: "start",
        behavior,
        id,
        type: "item",
      });
      firstLayoutItemIdsRef.current.delete(id);
      return true;
    },
    setAllCollapsed(collapsed: boolean): void {
      for (const item of parsedItemListRef.current) {
        setItemCollapsed(item.id, collapsed, false);
      }
      auditVisibleItems();
      scheduleRenderWindowReport();
    },
    selectAll(): boolean {
      const viewer = codeViewRef.current;
      if (!viewer) {
        return false;
      }
      const current = viewer.getSelectedLines();
      const candidateIds: string[] = [];
      if (current?.id) {
        candidateIds.push(current.id);
      }
      for (const rendered of viewer.getInstance()?.getRenderedItems() ?? []) {
        if (!candidateIds.includes(rendered.id)) {
          candidateIds.push(rendered.id);
        }
      }
      for (const item of parsedItemListRef.current) {
        if (!candidateIds.includes(item.id)) {
          candidateIds.push(item.id);
        }
      }
      for (const id of candidateIds) {
        const item =
          viewer.getItem(id) ??
          appliedItemsRef.current?.items.get(id) ??
          parsedItemsRef.current.get(id)?.item;
        const range = fullSelectionRangeForCodeViewItem(item);
        if (!(item && range)) {
          continue;
        }
        viewer.setSelectedLines({ id, range });
        const text = selectedLinesTextFromCodeViewItem(item, range);
        if (text.length > 0) {
          selectedTextRef.current = text;
        }
        return true;
      }
      return false;
    },
    updateItems(
      items: readonly PierDiffViewItem[],
      options?: PierDiffViewUpdateOptions
    ): boolean {
      const handle = codeViewRef.current;
      if (!handle) {
        return false;
      }
      // 默认 false：Pierre updateItem 内置行级 scroll anchoring。
      // 仅显式 preserveAnchor:true 时做 item 级 restore（identity 迁移等兜底）。
      const anchor =
        options?.preserveAnchor === true ? captureTopAnchor() : null;
      let allAccepted = true;
      let changed = false;
      for (const input of items) {
        const itemIndex = parsedItemIndexesRef.current.get(input.id);
        if (itemIndex === undefined) {
          // 拓扑换代 / Pierre 尚未接受新 initialItems 时，latest-map 可能短暂
          // 含有未知 id。跳过并返回 false，让上层下一帧重试，绝不能 throw 拖垮整树。
          allAccepted = false;
          continue;
        }
        const previous = parsedItemsRef.current.get(input.id);
        if (previous?.cacheKey === input.cacheKey) {
          continue;
        }
        const parsedItem = toCodeViewItem(input, previous);
        if (parsedItem.error && parsedItem.entry === previous) {
          itemErrorIdsRef.current.add(input.id);
          onItemErrorRef.current?.(input.id, parsedItem.error);
          continue;
        }
        let item = parsedItem.entry.item;
        const collapsed = collapsedItemsRef.current.get(input.id);
        if (collapsed) {
          item = {
            ...item,
            collapsed: collapsed.collapsed,
            version:
              (typeof item.version === "number" ? item.version : 0) +
              collapsed.revision,
          };
        }
        if (!acceptDiffViewItem(handle, item)) {
          allAccepted = false;
          continue;
        }
        parsedItemsRef.current.set(input.id, parsedItem.entry);
        parsedItemListRef.current[itemIndex] = item;
        renderItemIdentitiesRef.current.set(input.id, {
          cacheKey: input.cacheKey,
          version: item.version ?? 0,
        });
        appliedItemsRef.current?.items.set(input.id, item);
        if (parsedItem.error) {
          itemErrorIdsRef.current.add(input.id);
        } else {
          itemErrorIdsRef.current.delete(input.id);
        }
        onItemErrorRef.current?.(input.id, parsedItem.error);
        expectItemRender(input.id, item.version);
        changed = true;
      }
      if (!changed) {
        return allAccepted;
      }
      bumpItemEpoch();
      if (anchor) {
        restoreAnchor(anchor);
      }
      auditVisibleItems();
      scheduleRenderWindowReport();
      return allAccepted;
    },
  };
}
