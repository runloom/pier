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
      item.collapsed = collapsed;
      item.version = (typeof item.version === "number" ? item.version : 0) + 1;
      if (!handle.updateItem(item)) {
        return false;
      }
      const previous = collapsedItemsRef.current.get(id);
      collapsedItemsRef.current.set(id, {
        collapsed,
        revision: (previous?.revision ?? 0) + 1,
      });
      parsedItemListRef.current[itemIndex] = item;
      renderItemIdentitiesRef.current.set(id, {
        cacheKey: parsedItem.cacheKey,
        version: item.version ?? 0,
      });
      appliedItemsRef.current?.items.set(id, item);
      expectItemRender(id, item.version);
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
