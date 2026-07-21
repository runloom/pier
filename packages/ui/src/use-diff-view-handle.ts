import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
import { type Ref, type RefObject, useImperativeHandle, useMemo } from "react";
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

export interface PierDiffViewAnchor {
  readonly id: string;
  readonly offset: number;
}

export interface PierDiffViewHandle {
  captureTopAnchor(): PierDiffViewAnchor | null;
  /** Pierre 行选区文本；无选区时返回空串。 */
  getSelectedText(): string;
  isItemVisible(id: string, cacheKey?: string): boolean;
  restoreAnchor(anchor: PierDiffViewAnchor): boolean;
  scrollToItem(id: string): boolean;
  /** 全选当前（或最近）diff/file item 的全部行。 */
  selectAll(): boolean;
  /** 折叠/展开当前拓扑内的全部 diff item。 */
  setAllCollapsed(collapsed: boolean): void;
  updateItems(
    items: readonly PierDiffViewItem[],
    options?: PierDiffViewUpdateOptions
  ): boolean;
}

export interface PierDiffViewUpdateOptions {
  readonly preserveAnchor?: boolean;
}

export interface DiffViewCollapsedItemState {
  readonly collapsed: boolean;
  readonly revision: number;
}

export type DiffViewRenderItemIdentity = Pick<
  ParsedItemCacheEntry,
  "cacheKey" | "version"
>;

export function acceptDiffViewItem(
  handle: CodeViewHandle<undefined>,
  item: CodeViewItem
): boolean {
  const current = handle.getItem(item.id);
  if (current === item) {
    return true;
  }
  // version 是「内容版本 + 折叠修订」的单调计数:同 id 同 version 意味着
  // CodeView 已持有等价记录(常见于折叠后重投影产生的新克隆)。
  // CodeView.updateItem 对同版本更新返回 false,不能把它当作拒绝,
  // 否则 apply/replay 层重试耗尽后会误报「渲染差异失败」。
  if (current !== undefined && (current.version ?? 0) === (item.version ?? 0)) {
    return true;
  }
  return handle.updateItem(item);
}

interface UseDiffViewHandleOptions {
  readonly appliedItemsRef: RefObject<{
    readonly key: string;
    readonly items: Map<string, CodeViewItem>;
  } | null>;
  readonly auditVisibleItems: () => void;
  readonly codeViewRef: RefObject<CodeViewHandle<undefined> | null>;
  readonly collapsedItemsRef: RefObject<
    Map<string, DiffViewCollapsedItemState>
  >;
  readonly expectItemRender: (id: string, version: number | undefined) => void;
  readonly itemErrorIdsRef: RefObject<Set<string>>;
  readonly onItemErrorRef: RefObject<
    ((id: string, error: Error | null) => void) | undefined
  >;
  readonly parsedItemIndexesRef: RefObject<Map<string, number>>;
  readonly parsedItemListRef: RefObject<CodeViewItem[]>;
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
  codeViewRef,
  collapsedItemsRef,
  expectItemRender,
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
        codeViewRef,
        collapsedItemsRef,
        expectItemRender,
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
      codeViewRef,
      collapsedItemsRef,
      expectItemRender,
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
  codeViewRef,
  collapsedItemsRef,
  expectItemRender,
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
      if (!identity || (cacheKey && identity.cacheKey !== cacheKey)) {
        return false;
      }
      const visible = isRenderedItemVisible(
        viewer?.getContainerElement(),
        viewer?.getRenderedItems() ?? [],
        id,
        identity.version
      );
      return visible;
    },
    restoreAnchor(anchor: PierDiffViewAnchor): boolean {
      return restoreAnchor(anchor);
    },
    scrollToItem(id: string): boolean {
      const viewer = codeViewRef.current;
      const item = viewer?.getItem(id);
      if (!(viewer && item)) {
        return false;
      }
      if (item.collapsed === true && !setItemCollapsed(id, false, false)) {
        return false;
      }
      viewer.scrollTo({
        align: "start",
        behavior: "instant",
        id,
        type: "item",
      });
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
      const anchor =
        options?.preserveAnchor === false ? null : captureTopAnchor();
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
      if (anchor) {
        restoreAnchor(anchor);
      }
      auditVisibleItems();
      scheduleRenderWindowReport();
      return allAccepted;
    },
  };
}
