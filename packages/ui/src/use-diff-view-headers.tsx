import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
import { type RefObject, useCallback, useEffect, useMemo } from "react";
import {
  CollapseDiffButton,
  type PierDiffViewLabels,
} from "./diff-view-collapse.tsx";
import {
  fileDiffLineStats,
  type ParsedItemCacheEntry,
  type PierDiffViewItem,
} from "./diff-view-items.ts";
import {
  pierDiffItemPresentation,
  shouldRenderDiffLineStats,
} from "./diff-view-presentation.ts";
import type {
  DiffViewCollapsedItemState,
  DiffViewRenderItemIdentity,
} from "./use-diff-view-handle.ts";

const USER_SCROLL_KEYS = new Set([
  " ",
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

export function useDiffViewHeaders(options: {
  readonly appliedItemsRef: RefObject<{
    readonly items: Map<string, CodeViewItem>;
    readonly key: string;
  } | null>;
  readonly auditVisibleItems: () => void;
  readonly codeViewItems: CodeViewItem[];
  readonly codeViewRef: RefObject<CodeViewHandle<undefined> | null>;
  readonly collapsedItemsRef: RefObject<
    Map<string, DiffViewCollapsedItemState>
  >;
  readonly expectItemRender: (id: string, version: number | undefined) => void;
  readonly inputs: readonly PierDiffViewItem[];
  readonly labels: PierDiffViewLabels;
  readonly onScroll?: (() => void) | undefined;
  readonly parsedItemIndexesRef: RefObject<Map<string, number>>;
  readonly parsedItemListRef: RefObject<CodeViewItem[]>;
  readonly parsedItemsRef: RefObject<Map<string, ParsedItemCacheEntry>>;
  readonly renderItemIdentitiesRef: RefObject<
    Map<string, DiffViewRenderItemIdentity>
  >;
  readonly scheduleRenderWindowReport: () => void;
}): {
  readonly handleCodeViewScroll: () => void;
  readonly handleUserScrollKey: (
    event: React.KeyboardEvent<HTMLDivElement>
  ) => void;
  readonly renderHeaderMetadata: (item: CodeViewItem) => React.ReactNode;
  readonly renderHeaderPrefix: (item: CodeViewItem) => React.ReactNode;
  readonly setItemCollapsed: (
    id: string,
    nextCollapsed?: boolean,
    preserveTopAnchor?: boolean
  ) => boolean;
} {
  const {
    appliedItemsRef,
    auditVisibleItems,
    codeViewItems,
    codeViewRef,
    collapsedItemsRef,
    expectItemRender,
    inputs,
    labels,
    onScroll,
    parsedItemIndexesRef,
    parsedItemListRef,
    parsedItemsRef,
    renderItemIdentitiesRef,
    scheduleRenderWindowReport,
  } = options;

  const setItemCollapsed = useCallback(
    (id: string, nextCollapsed?: boolean, preserveTopAnchor = true) => {
      const handle = codeViewRef.current;
      const viewer = handle?.getInstance();
      const item = handle?.getItem(id);
      const itemIndex = parsedItemIndexesRef.current.get(id);
      const parsedItem = parsedItemsRef.current.get(id);
      if (
        !(handle && viewer && item && itemIndex !== undefined && parsedItem)
      ) {
        return false;
      }
      const collapsed = nextCollapsed ?? item.collapsed !== true;
      if (item.collapsed === collapsed) {
        return true;
      }
      const itemTop = viewer.getTopForItem(id);
      const shouldAnchor =
        preserveTopAnchor &&
        itemTop !== undefined &&
        itemTop !== null &&
        itemTop < viewer.getScrollTop();
      const nextRevision =
        (collapsedItemsRef.current.get(id)?.revision ?? 0) + 1;
      // 克隆而非就地改写:CodeView 里可能持有 parsed cache 的原始 item 引用,
      // 就地 +1 会把缓存条目的内容版本一并顶高,与「内容版本 + 折叠修订」的
      // 统一公式撞号 —— 折叠中的占位符会与稍后到达的真实正文同号,
      // CodeView 按 version 去重时把正文当作无变化丢弃(表现为导航后空正文)。
      const nextItem = {
        ...parsedItem.item,
        collapsed,
        version: parsedItem.version + nextRevision,
      };
      if (!handle.updateItem(nextItem)) {
        return false;
      }
      collapsedItemsRef.current.set(id, {
        collapsed,
        revision: nextRevision,
      });
      parsedItemListRef.current[itemIndex] = nextItem;
      renderItemIdentitiesRef.current.set(id, {
        cacheKey: parsedItem.cacheKey,
        version: nextItem.version,
      });
      appliedItemsRef.current?.items.set(id, nextItem);
      expectItemRender(id, nextItem.version);
      if (shouldAnchor) {
        handle.scrollTo({
          align: "start",
          id,
          type: "item",
        });
      }
      auditVisibleItems();
      scheduleRenderWindowReport();
      return true;
    },
    [
      appliedItemsRef,
      auditVisibleItems,
      codeViewRef,
      collapsedItemsRef,
      expectItemRender,
      parsedItemIndexesRef,
      parsedItemListRef,
      parsedItemsRef,
      renderItemIdentitiesRef,
      scheduleRenderWindowReport,
    ]
  );
  const handleToggleItemCollapsed = useCallback(
    (item: CodeViewItem) => {
      setItemCollapsed(item.id);
    },
    [setItemCollapsed]
  );
  const handleCodeViewScroll = useCallback(() => {
    auditVisibleItems();
    scheduleRenderWindowReport();
  }, [auditVisibleItems, scheduleRenderWindowReport]);
  const handleUserScrollKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (USER_SCROLL_KEYS.has(event.key)) {
        onScroll?.();
      }
    },
    [onScroll]
  );
  useEffect(() => {
    if (codeViewItems.length === 0) {
      return;
    }
    auditVisibleItems();
    scheduleRenderWindowReport();
  }, [auditVisibleItems, codeViewItems, scheduleRenderWindowReport]);
  const inputById = useMemo(() => {
    const map = new Map<string, PierDiffViewItem>();
    for (const input of inputs) {
      map.set(input.id, input);
    }
    return map;
  }, [inputs]);
  const renderHeaderPrefix = useCallback(
    (item: CodeViewItem) => {
      if (item.type !== "diff") {
        return null;
      }
      const input = inputById.get(item.id);
      const loading =
        input !== undefined && pierDiffItemPresentation(input) === "loading";
      const emptyReady =
        !loading &&
        item.fileDiff.splitLineCount === 0 &&
        item.fileDiff.unifiedLineCount === 0;
      return (
        <CollapseDiffButton
          collapsed={item.collapsed === true}
          disabled={emptyReady}
          labels={labels}
          loading={loading}
          onToggle={() => handleToggleItemCollapsed(item)}
        />
      );
    },
    [handleToggleItemCollapsed, inputById, labels]
  );
  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem) => {
      if (item.type !== "diff") {
        return null;
      }
      const input = inputById.get(item.id);
      if (
        input !== undefined &&
        pierDiffItemPresentation(input) === "loading"
      ) {
        return null;
      }
      const { additions, deletions } = fileDiffLineStats(item.fileDiff);
      if (!shouldRenderDiffLineStats({ additions, deletions })) {
        return null;
      }
      return (
        <>
          {deletions > 0 ? (
            <span
              data-pier-diff-stat="deletions"
              style={{
                color: "var(--diffs-deletion-base)",
                fontFamily:
                  "var(--diffs-font-family, var(--diffs-font-fallback))",
              }}
            >
              {`-${deletions}`}
            </span>
          ) : null}
          {additions > 0 ? (
            <span
              data-pier-diff-stat="additions"
              style={{
                color: "var(--diffs-addition-base)",
                fontFamily:
                  "var(--diffs-font-family, var(--diffs-font-fallback))",
              }}
            >
              {`+${additions}`}
            </span>
          ) : null}
        </>
      );
    },
    [inputById]
  );
  return {
    handleCodeViewScroll,
    handleUserScrollKey,
    renderHeaderMetadata,
    renderHeaderPrefix,
    setItemCollapsed,
  };
}
