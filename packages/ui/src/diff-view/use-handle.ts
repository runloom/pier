import type { CodeViewHandle } from "@pierre/diffs/react";
import { type Ref, type RefObject, useImperativeHandle, useMemo } from "react";
import type {
  DiffViewCollapsedItemState,
  DiffViewRenderItemIdentity,
  PierDiffViewAnchor,
  PierDiffViewHandle,
  PierDiffViewLineSelection,
  PierDiffViewUpdateOptions,
} from "./handle-types.ts";
import type { PierHunkAnnotationMetadata } from "./hunk-actions.tsx";
import {
  captureDiffViewItemAnchor,
  captureDiffViewTopAnchor,
} from "./item-anchor.ts";
import { applyCodeViewItemsAnchored } from "./item-sync.ts";
import type {
  ParsedItemCacheEntry,
  PierDiffCodeViewItem,
  PierDiffViewItem,
} from "./items.ts";
import { toCodeViewItem } from "./items.ts";
import { isRenderedItemVisible } from "./render-watchdog.ts";
import {
  type DiffViewScrollOptions,
  resolveCodeViewScrollElement,
} from "./scroll-behavior.ts";
import {
  fullSelectionRangeForCodeViewItem,
  selectedLinesTextFromCodeViewItem,
} from "./selection-text.ts";
import { waitForStableViewportLayout } from "./viewport-layout.ts";

const INSTANT_SCROLL_LAYOUT_PASSES = 2;

export type {
  DiffViewCollapsedItemState,
  DiffViewRenderItemIdentity,
  PierDiffViewAnchor,
  PierDiffViewHandle,
  PierDiffViewLineSelection,
  PierDiffViewUpdateOptions,
} from "./handle-types.ts";
export { acceptDiffViewItem } from "./item-sync.ts";

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
  const getViewportLayoutKey = (targetItemId?: string): string | null => {
    const viewer = codeViewRef.current?.getInstance();
    const container = resolveScrollContainer();
    if (!(viewer && container)) {
      return null;
    }
    const target =
      targetItemId === undefined
        ? undefined
        : viewer
            .getRenderedItems()
            .find((rendered) => rendered.id === targetItemId);
    let targetTop: number | "none" | "unrendered" = "none";
    if (targetItemId !== undefined) {
      targetTop = target
        ? viewer.getLocalTopForInstance(target.instance)
        : "unrendered";
    }
    return `${container.clientWidth}:${container.clientHeight}:${container.scrollHeight}:${targetTop}`;
  };
  const captureTopAnchor = (): PierDiffViewAnchor | null =>
    captureDiffViewTopAnchor(codeViewRef.current?.getInstance());
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
    captureItemAnchor: (id) =>
      captureDiffViewItemAnchor(codeViewRef.current?.getInstance(), id),
    captureTopAnchor(): PierDiffViewAnchor | null {
      return captureTopAnchor();
    },
    getRenderedItemHeights(): ReadonlyMap<string, number> {
      const rendered =
        codeViewRef.current?.getInstance()?.getRenderedItems() ?? [];
      return new Map(
        rendered
          .map(
            (item) =>
              [item.id, item.element.getBoundingClientRect().height] as const
          )
          .filter((entry) => Number.isFinite(entry[1]) && entry[1] > 0)
      );
    },
    getScrollTop(): number | null {
      const container = resolveScrollContainer();
      return container ? container.scrollTop : null;
    },
    getViewportLayoutKey(targetItemId?: string): string | null {
      return getViewportLayoutKey(targetItemId);
    },
    isViewportReady(): boolean {
      const container = resolveScrollContainer();
      return Boolean(
        container?.isConnected &&
          container.clientWidth > 0 &&
          container.clientHeight > 0 &&
          container.checkVisibility({ visibilityProperty: true })
      );
    },
    requestViewportLayoutSettled(
      targetItemId: string,
      stableFrames: number,
      callback: () => void
    ): () => void {
      return waitForStableViewportLayout(
        () => getViewportLayoutKey(targetItemId),
        stableFrames,
        callback
      );
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
    scrollToItem(id: string, options?: DiffViewScrollOptions): boolean {
      const viewer = codeViewRef.current;
      const item = viewer?.getItem(id);
      if (!(viewer && item)) {
        return false;
      }
      // 显式 behavior 优先（树导航主路径恒传 instant）。
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
        ...(options?.offset === undefined ? {} : { offset: options.offset }),
        type: "item",
      });
      if (behavior === "instant") {
        // Distant virtual items expand their rendered line window during the
        // first CodeView pass. Flush that same semantic scroll before paint so
        // users never see the estimate-sized target followed by its measured
        // geometry one frame later.
        const instance = viewer.getInstance();
        for (let pass = 0; pass < INSTANT_SCROLL_LAYOUT_PASSES; pass += 1) {
          instance?.render(true);
        }
      }
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
      const nextItemList = [...parsedItemListRef.current];
      const acceptedEntries: {
        readonly input: PierDiffViewItem;
        readonly item: PierDiffCodeViewItem;
        readonly itemIndex: number;
        readonly parsedItem: ParsedItemCacheEntry;
        readonly error: Error | null;
      }[] = [];
      for (const input of items) {
        const itemIndex = parsedItemIndexesRef.current.get(input.id);
        if (itemIndex === undefined) {
          // 稀疏更新必须全有或全无。未知 id 表示调用方持有旧拓扑，不能先提交
          // 其余已知项再跨帧补写，否则同一次暂存会产生两个可见正文状态。
          return false;
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
        nextItemList[itemIndex] = item;
        acceptedEntries.push({
          error: parsedItem.error,
          input,
          item,
          itemIndex,
          parsedItem: parsedItem.entry,
        });
      }
      if (acceptedEntries.length === 0) {
        return true;
      }
      const anchor =
        options?.preserveAnchor === true ? captureTopAnchor() : null;
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
      for (const entry of acceptedEntries) {
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
      bumpItemEpoch();
      if (anchor) {
        restoreAnchor(anchor);
      }
      auditVisibleItems();
      scheduleRenderWindowReport();
      return true;
    },
  };
}
