/**
 * 稀疏正文更新（`PierDiffViewHandle.updateItems`）。
 *
 * 拆出独立模块：正文更新自成事务（全有或全无 + 折叠层继承 + 锚点保持），
 * 与 handle 的滚动 / 选区能力无耦合。
 */
import {
  applyCollapsedItemState,
  resolveCollapsedItemState,
} from "./collapse-intent.ts";
import type { DiffViewHandleDeps } from "./handle-deps.ts";
import type { PierDiffViewAnchor } from "./handle-types.ts";
import { applyCodeViewItemsAnchored } from "./item-sync.ts";
import type {
  ParsedItemCacheEntry,
  PierDiffCodeViewItem,
  PierDiffViewItem,
} from "./items.ts";
import { toCodeViewItem } from "./items.ts";

interface AcceptedEntry {
  readonly error: Error | null;
  readonly input: PierDiffViewItem;
  readonly item: PierDiffCodeViewItem;
  readonly itemIndex: number;
  readonly parsedItem: ParsedItemCacheEntry;
}

export interface DiffViewAnchorPort {
  readonly capture: () => PierDiffViewAnchor | null;
  readonly restore: (anchor: PierDiffViewAnchor) => boolean;
}

export function createDiffViewUpdateItems(
  deps: DiffViewHandleDeps,
  anchors: DiffViewAnchorPort
): (
  items: readonly PierDiffViewItem[],
  options?: { readonly preserveAnchor?: boolean }
) => boolean {
  const {
    appliedItemsRef,
    auditVisibleItems,
    bumpItemEpoch,
    codeViewRef,
    collapseAllIntentRef,
    collapsedItemsRef,
    expectItemRender,
    itemErrorIdsRef,
    onItemErrorRef,
    parsedItemIndexesRef,
    parsedItemListRef,
    parsedItemsRef,
    renderItemIdentitiesRef,
    scheduleRenderWindowReport,
  } = deps;

  const collectAccepted = (
    items: readonly PierDiffViewItem[],
    nextItemList: PierDiffCodeViewItem[]
  ): AcceptedEntry[] | null => {
    const accepted: AcceptedEntry[] = [];
    for (const input of items) {
      const itemIndex = parsedItemIndexesRef.current.get(input.id);
      if (itemIndex === undefined) {
        // 稀疏更新必须全有或全无。未知 id 表示调用方持有旧拓扑，不能先提交
        // 其余已知项再跨帧补写，否则同一次暂存会产生两个可见正文状态。
        return null;
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
      // estimate→loaded 必须继承折叠层，否则「折叠全部」后到达的正文会弹开。
      const item = applyCollapsedItemState(
        parsedItem.entry.item,
        resolveCollapsedItemState(
          parsedItem.entry.item,
          collapsedItemsRef.current.get(input.id),
          collapseAllIntentRef.current
        )
      );
      nextItemList[itemIndex] = item;
      accepted.push({
        error: parsedItem.error,
        input,
        item,
        itemIndex,
        parsedItem: parsedItem.entry,
      });
    }
    return accepted;
  };

  const commitAccepted = (accepted: readonly AcceptedEntry[]): void => {
    for (const entry of accepted) {
      parsedItemsRef.current.set(entry.input.id, entry.parsedItem);
      parsedItemListRef.current[entry.itemIndex] = entry.item;
      renderItemIdentitiesRef.current.set(entry.input.id, {
        cacheKey: entry.input.cacheKey,
        version: entry.item.version ?? 0,
      });
      appliedItemsRef.current?.items.set(entry.input.id, entry.item);
      if (entry.error) {
        itemErrorIdsRef.current.add(entry.input.id);
      } else {
        itemErrorIdsRef.current.delete(entry.input.id);
      }
      onItemErrorRef.current?.(entry.input.id, entry.error);
      expectItemRender(entry.input.id, entry.item.version);
    }
  };

  return (items, options) => {
    const handle = codeViewRef.current;
    if (!handle) {
      return false;
    }
    const nextItemList = [...parsedItemListRef.current];
    const accepted = collectAccepted(items, nextItemList);
    if (accepted === null) {
      return false;
    }
    if (accepted.length === 0) {
      return true;
    }
    const anchor = options?.preserveAnchor === true ? anchors.capture() : null;
    // estimate→loaded 等正文更新必须 flush；否则可见 estimate DOM 要滚一下才换真 patch
    const result = applyCodeViewItemsAnchored(
      handle,
      nextItemList,
      parsedItemListRef.current,
      { flushLayout: true }
    );
    if (!result.accepted) {
      return false;
    }
    commitAccepted(accepted);
    bumpItemEpoch();
    if (anchor) {
      anchors.restore(anchor);
    }
    auditVisibleItems();
    scheduleRenderWindowReport();
    return true;
  };
}
