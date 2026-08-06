import type { CodeViewHandle } from "@pierre/diffs/react";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import type { PierDiffViewLabels } from "./collapse.tsx";
import type { DiffViewCollapseAllIntent } from "./collapse-intent.ts";
import type { DiffMetrics } from "./geometry.ts";
import type { PierDriftCommentLabels } from "./gutter/gutter-comments.tsx";
import {
  composedHtmlPath,
  findHeaderFromPath,
  findRenderedItemIdFromPath,
  findTitleFromPath,
  isHeaderControlTarget,
  isInteractiveControlTarget,
  USER_SCROLL_INTENT_GESTURE_MS,
  USER_SCROLL_KEYS,
} from "./header-events.ts";
import type { DiffViewInputStore } from "./input-store.ts";
import type { ParsedItemCacheEntry, PierDiffCodeViewItem } from "./items.ts";
import {
  applyDiffVirtualHeights,
  pinCodeViewScrollHeight,
} from "./layout-apply.ts";
import { LiveHeaderMetadata, LiveHeaderPrefix } from "./live-headers.tsx";
import { pierDiffItemPresentation } from "./presentation.ts";
import type { PierDiffAnnotationMetadata } from "./review/annotation-types.ts";
import type {
  DiffViewCollapsedItemState,
  DiffViewRenderItemIdentity,
} from "./use-handle.ts";

export function useDiffViewHeaders(options: {
  readonly appliedItemsRef: RefObject<{
    readonly items: Map<string, PierDiffCodeViewItem>;
    readonly key: string;
  } | null>;
  readonly auditVisibleItems: () => void;
  readonly bumpItemEpoch: () => void;
  readonly codeViewItems: PierDiffCodeViewItem[];
  readonly codeViewRef: RefObject<CodeViewHandle<PierDiffAnnotationMetadata> | null>;
  readonly collapseAllIntentRef: RefObject<DiffViewCollapseAllIntent>;
  readonly collapsedItemsRef: RefObject<
    Map<string, DiffViewCollapsedItemState>
  >;
  readonly expectItemRender: (id: string, version: number | undefined) => void;
  readonly inputStore: DiffViewInputStore;
  /** 用户是否主动收起了该槽（区别于 estimate 的技术默认折叠）。 */
  readonly isUserCollapsed: (itemId: string) => boolean;
  readonly driftCommentLabels?: PierDriftCommentLabels | undefined;
  readonly labels: PierDiffViewLabels;
  /** 唯一几何 metrics；单槽折叠后与 collapse-all 同路径钉 H/S。 */
  readonly metrics: DiffMetrics;
  readonly onDiscardFile?: ((itemId: string) => void) | undefined;
  /** drift 评论 chip 点击（host 打开线程卡，仅传 threadId）。 */
  readonly onDriftCommentActivate?: ((threadId: string) => void) | undefined;
  readonly onOpenFile?: ((itemId: string) => void) | undefined;
  readonly onRetryItem?: ((itemId: string) => void) | undefined;
  readonly onToggleStage?: ((itemId: string) => void) | undefined;
  readonly onScroll?: (() => void) | undefined;
  readonly parsedItemIndexesRef: RefObject<Map<string, number>>;
  readonly parsedItemListRef: RefObject<PierDiffCodeViewItem[]>;
  readonly parsedItemsRef: RefObject<Map<string, ParsedItemCacheEntry>>;
  readonly renderItemIdentitiesRef: RefObject<
    Map<string, DiffViewRenderItemIdentity>
  >;
  readonly scheduleRenderWindowReport: () => void;
}): {
  readonly handleCodeViewScroll: () => void;
  readonly handleHeaderClickCapture: (
    event: React.MouseEvent<HTMLDivElement>
  ) => void;
  /** 明确用户手势（wheel/touch/page keys），非官方 onScroll。 */
  readonly handleUserScrollIntent: () => void;
  readonly handleUserScrollKey: (
    event: React.KeyboardEvent<HTMLDivElement>
  ) => void;
  readonly renderHeaderMetadata: (
    item: PierDiffCodeViewItem
  ) => React.ReactNode;
  readonly renderHeaderPrefix: (item: PierDiffCodeViewItem) => React.ReactNode;
  readonly setItemCollapsed: (
    id: string,
    nextCollapsed?: boolean,
    preserveTopAnchor?: boolean,
    reconcileHeights?: boolean
  ) => boolean;
} {
  const {
    appliedItemsRef,
    auditVisibleItems,
    bumpItemEpoch,
    codeViewItems,
    codeViewRef,
    collapseAllIntentRef,
    collapsedItemsRef,
    expectItemRender,
    inputStore,
    driftCommentLabels,
    isUserCollapsed,
    labels,
    metrics,
    onDiscardFile,
    onDriftCommentActivate,
    onOpenFile,
    onRetryItem,
    onToggleStage,
    onScroll,
    parsedItemIndexesRef,
    parsedItemListRef,
    parsedItemsRef,
    renderItemIdentitiesRef,
    scheduleRenderWindowReport,
  } = options;
  const userScrollGestureActiveRef = useRef(false);
  const userScrollGestureTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const setItemCollapsed = useCallback(
    (
      id: string,
      nextCollapsed?: boolean,
      preserveTopAnchor = true,
      reconcileHeights = true
    ) => {
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
      // 不把折叠 revision 写回 parsedItems.version：内容 cache 的 version 只跟
      // patch/cacheKey 走；折叠层的 version 增量只存在于 CodeView 活体 item 与
      // collapsedItemsRef.revision，避免 updateItems 再 +revision 时撞号/跳号。
      parsedItemListRef.current[itemIndex] = nextItem;
      renderItemIdentitiesRef.current.set(id, {
        cacheKey: parsedItem.cacheKey,
        version: nextItem.version,
      });
      appliedItemsRef.current?.items.set(id, nextItem);
      expectItemRender(id, nextItem.version);
      bumpItemEpoch();
      // 单槽切换：立即全表写 H + 钉 S。collapse-all 批量路径传 reconcileHeights=false，
      // 循环结束后只 reconcile 一次（避免 O(n²)）。
      if (reconcileHeights) {
        const heightOptions = {
          isCollapseAllIntent: () => collapseAllIntentRef.current === true,
          isUserCollapsed,
          metrics,
        };
        applyDiffVirtualHeights(viewer, heightOptions);
        pinCodeViewScrollHeight(viewer, metrics.gap);
      }
      if (shouldAnchor) {
        handle.scrollTo({
          align: "start",
          id,
          type: "item",
        });
      }
      if (reconcileHeights) {
        auditVisibleItems();
        scheduleRenderWindowReport();
      }
      return true;
    },
    [
      appliedItemsRef,
      auditVisibleItems,
      bumpItemEpoch,
      codeViewRef,
      collapseAllIntentRef,
      collapsedItemsRef,
      expectItemRender,
      isUserCollapsed,
      metrics,
      parsedItemIndexesRef,
      parsedItemListRef,
      parsedItemsRef,
      renderItemIdentitiesRef,
      scheduleRenderWindowReport,
    ]
  );
  const handleToggleItemCollapsed = useCallback(
    (item: PierDiffCodeViewItem) => {
      setItemCollapsed(item.id);
    },
    [setItemCollapsed]
  );
  const handleCodeViewScroll = useCallback(() => {
    // 官方 onScroll：只更新 render window / watchdog，不冒充用户意图
    auditVisibleItems();
    scheduleRenderWindowReport();
  }, [auditVisibleItems, scheduleRenderWindowReport]);
  const handleUserScrollIntent = useCallback(() => {
    // 手势级合并：连续 wheel 只通知宿主一次，gesture 结束后才重新武装
    if (!userScrollGestureActiveRef.current) {
      userScrollGestureActiveRef.current = true;
      onScroll?.();
    }
    if (userScrollGestureTimerRef.current !== null) {
      clearTimeout(userScrollGestureTimerRef.current);
    }
    userScrollGestureTimerRef.current = setTimeout(() => {
      userScrollGestureActiveRef.current = false;
      userScrollGestureTimerRef.current = null;
    }, USER_SCROLL_INTENT_GESTURE_MS);
  }, [onScroll]);
  const handleUserScrollKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        USER_SCROLL_KEYS.has(event.key) &&
        !isInteractiveControlTarget(composedHtmlPath(event.nativeEvent))
      ) {
        handleUserScrollIntent();
      }
    },
    [handleUserScrollIntent]
  );
  useEffect(
    () => () => {
      if (userScrollGestureTimerRef.current !== null) {
        clearTimeout(userScrollGestureTimerRef.current);
      }
    },
    []
  );
  useEffect(() => {
    if (codeViewItems.length === 0) {
      return;
    }
    auditVisibleItems();
    scheduleRenderWindowReport();
  }, [auditVisibleItems, codeViewItems, scheduleRenderWindowReport]);
  const handleHeaderClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const path = composedHtmlPath(event.nativeEvent);
      const header = findHeaderFromPath(path);
      if (!header) {
        return;
      }
      if (isHeaderControlTarget(path)) {
        return;
      }
      const viewer = codeViewRef.current?.getInstance();
      if (!viewer) {
        return;
      }
      const itemId = findRenderedItemIdFromPath(
        event.nativeEvent.composedPath(),
        viewer.getRenderedItems()
      );
      if (!itemId) {
        return;
      }
      const title = findTitleFromPath(path);
      if (title && onOpenFile) {
        event.preventDefault();
        event.stopPropagation();
        onOpenFile(itemId);
        return;
      }
      // Title without open handler still collapses like blank chrome.
      const input = inputStore.get(itemId);
      if (
        input !== undefined &&
        pierDiffItemPresentation(input) === "loading"
      ) {
        return;
      }
      const item = codeViewRef.current?.getItem(itemId);
      if (item?.type !== "diff") {
        return;
      }
      if (
        item.fileDiff.splitLineCount === 0 &&
        item.fileDiff.unifiedLineCount === 0 &&
        item.collapsed !== true
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleToggleItemCollapsed(item);
    },
    [codeViewRef, handleToggleItemCollapsed, inputStore, onOpenFile]
  );
  const renderHeaderPrefix = useCallback(
    (item: PierDiffCodeViewItem) => {
      if (item.type !== "diff") {
        return null;
      }
      return (
        <LiveHeaderPrefix
          inputStore={inputStore}
          item={item}
          labels={labels}
          onToggle={handleToggleItemCollapsed}
          userCollapsed={isUserCollapsed(item.id)}
        />
      );
    },
    [handleToggleItemCollapsed, inputStore, isUserCollapsed, labels]
  );
  const renderHeaderMetadata = useCallback(
    (item: PierDiffCodeViewItem) => {
      if (item.type !== "diff") {
        return null;
      }
      return (
        <LiveHeaderMetadata
          inputStore={inputStore}
          item={item}
          labels={labels}
          {...(driftCommentLabels === undefined ? {} : { driftCommentLabels })}
          {...(onDiscardFile === undefined ? {} : { onDiscardFile })}
          {...(onDriftCommentActivate === undefined
            ? {}
            : { onDriftCommentActivate })}
          {...(onRetryItem === undefined ? {} : { onRetryItem })}
          {...(onToggleStage === undefined ? {} : { onToggleStage })}
        />
      );
    },
    [
      driftCommentLabels,
      inputStore,
      labels,
      onDiscardFile,
      onDriftCommentActivate,
      onRetryItem,
      onToggleStage,
    ]
  );
  return {
    handleCodeViewScroll,
    handleHeaderClickCapture,
    handleUserScrollIntent,
    handleUserScrollKey,
    renderHeaderMetadata,
    renderHeaderPrefix,
    setItemCollapsed,
  };
}
