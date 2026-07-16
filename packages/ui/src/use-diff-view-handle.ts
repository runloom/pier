import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
import { type Ref, type RefObject, useImperativeHandle, useMemo } from "react";
import {
  type ParsedItemCacheEntry,
  type PierDiffViewItem,
  toCodeViewItem,
} from "./diff-view-items.ts";
import { isRenderedItemVisible } from "./diff-view-render-watchdog.ts";

export interface PierDiffViewAnchor {
  readonly id: string;
  readonly offset: number;
}

export interface PierDiffViewHandle {
  captureTopAnchor(): PierDiffViewAnchor | null;
  isItemVisible(id: string, cacheKey?: string): boolean;
  restoreAnchor(anchor: PierDiffViewAnchor): boolean;
  scrollToItem(id: string): boolean;
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
  return handle.getItem(item.id) === item || handle.updateItem(item);
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
    isItemVisible(id: string, cacheKey?: string): boolean {
      const viewer = codeViewRef.current?.getInstance();
      const identity = renderItemIdentitiesRef.current.get(id);
      if (!identity || (cacheKey && identity.cacheKey !== cacheKey)) {
        return false;
      }
      return isRenderedItemVisible(
        viewer?.getContainerElement(),
        viewer?.getRenderedItems() ?? [],
        id,
        identity.version
      );
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
          throw new Error(
            `Pierre diff item topology does not contain ${input.id}`
          );
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
