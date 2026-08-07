import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ensurePierDiffLightDomStyles,
  pierDiffCodeViewKey,
  pierDiffRenderEnvironment,
  pierDiffThemeKey,
} from "./appearance.ts";
import {
  applyCollapseIntentToItems,
  type DiffViewCollapseAllIntent,
  useUserCollapsedPredicate,
} from "./collapse-intent.ts";
import { diffMetrics } from "./geometry.ts";
import { useDiffViewInputStore } from "./input-store.ts";
import {
  type ParsedItemCacheEntry,
  type PierDiffViewItem,
  toCodeViewItems,
} from "./items.ts";
import { useDiffRenderWatchdog } from "./render-watchdog.ts";
import { useDiffRenderWindowReport } from "./render-window.ts";
import type { PierDiffAnnotationMetadata } from "./review/annotation-types.ts";
import { useDiffViewReviewAnnotationMerge } from "./review/use-review-annotation-merge.ts";
import { stabilizeCodeViewStickyPositioning } from "./sticky-stabilize.ts";
import {
  captureTopologyScrollRestore,
  restoreTopologyScroll,
  type TopologyScrollRestore,
} from "./topology-scroll.ts";
import type { PierDiffViewProps } from "./types.ts";
import { useDiffViewCodeOptions } from "./use-code-options.ts";
import { useDiffViewContentSelection } from "./use-content-selection.ts";
import {
  type DiffViewCollapsedItemState,
  type DiffViewRenderItemIdentity,
  useDiffViewHandle,
} from "./use-handle.ts";
import { useDiffViewHeaders } from "./use-headers.tsx";
import { useDiffViewItemApply } from "./use-item-apply.ts";
import { PierDiffViewShell } from "./view-shell.tsx";

export {
  diffMetrics,
  slotVirtualHeight,
  totalScrollHeight,
} from "./geometry.ts";
export type {
  PierDriftCommentLabels,
  PierGutterReviewEvent,
} from "./gutter/gutter-comments.tsx";
export type {
  PierDiffViewAnchor,
  PierDiffViewHandle,
  PierDiffViewLineSelection,
  PierDiffViewPointerLineHit,
  PierDiffViewUpdateOptions,
} from "./handle-types.ts";
export type {
  PierHunkActionEvent,
  PierHunkAnnotationMetadata,
} from "./hunk-actions.tsx";
export type {
  PierDiffReviewCommentThread,
  PierDiffReviewDriftThread,
  PierDiffViewChangeControl,
  PierDiffViewFileDisplay,
  PierDiffViewItem,
  PierDiffViewStageControl,
} from "./items.ts";
export type { PierDiffViewRenderWindow } from "./render-window.ts";
export type { PierActiveReviewSlot } from "./review/annotation-anchors.ts";
export type {
  PierDiffAnnotationMetadata,
  PierDiffReviewAnnotationMetadata,
  PierReviewDraftAnnotationMetadata,
  PierReviewThreadAnnotationMetadata,
} from "./review/annotation-types.ts";
export type {
  PierInlineReviewComment,
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "./review/inline-comment-types.ts";
export { InlineReviewThreadCard } from "./review/inline-thread-card.tsx";
export {
  fullSelectionRangeForCodeViewItem,
  selectedLinesTextFromCodeViewItem,
} from "./selection-text.ts";
export type {
  PierDiffViewAppearance,
  PierDiffViewLabels,
  PierDiffViewPresentation,
  PierDiffViewProps,
} from "./types.ts";

const INLINE_RENDER_TIMEOUT_MS = 10_000;
export function PierDiffView({
  activeReviewEpoch,
  activeReviewSlotsByItem,
  appearance,
  items: inputs,
  labels,
  driftCommentLabels,
  inlineReviewHandlers,
  inlineReviewLabels,
  inlineReviewThreadById,
  locale,
  onDiscardFile,
  onDriftCommentActivate,
  onError,
  onHunkAction,
  onItemError,
  onGutterReviewActivate,
  onOpenFile,
  onRenderWindowChange,
  onRetryItem,
  onScroll,
  onToggleStage,
  presentation,
  reviewCommentsById,
  ref,
  getSuppressMembershipScrollRestore,
  suppressMembershipScrollRestore = false,
}: PierDiffViewProps): React.JSX.Element | null {
  const diffStyle = presentation?.diffStyle ?? "split";
  const overflow = presentation?.wrapLines === true ? "wrap" : "scroll";
  const codeViewRef = useRef<CodeViewHandle<PierDiffAnnotationMetadata>>(null);
  // Light-DOM portal pills need document CSS (shadow unsafeCSS cannot reach them).
  useEffect(() => {
    ensurePierDiffLightDomStyles();
  }, []);
  const parsedItemsRef = useRef(new Map<string, ParsedItemCacheEntry>());
  const renderItemIdentitiesRef = useRef(
    new Map<string, DiffViewRenderItemIdentity>()
  );
  const itemErrorIdsRef = useRef(new Set<string>());
  const onItemErrorRef = useRef(onItemError);
  const collapsedItemsRef = useRef(
    new Map<string, DiffViewCollapsedItemState>()
  );
  /** 工具栏折叠全部：覆盖此后才水合 / 才进投影窗口的槽位。 */
  const collapseAllIntentRef = useRef<DiffViewCollapseAllIntent>(null);
  const parsedItemIndexesRef = useRef(new Map<string, number>());
  const parsedItemListRef = useRef<CodeViewItem<PierDiffAnnotationMetadata>[]>(
    []
  );
  const parsedInputsRef = useRef<readonly PierDiffViewItem[] | null>(null);
  const appliedItemsRef = useRef<{
    readonly key: string;
    readonly items: Map<string, CodeViewItem<PierDiffAnnotationMetadata>>;
  } | null>(null);
  /** 最近一次 membership apply 新建的 item id；scrollToItem 用 instant。 */
  const firstLayoutItemIdsRef = useRef(new Set<string>());
  /** 仅布局不变量（lineHeight/diffStyle）remount 时恢复视口；成员/stage 变更不走此路径。 */
  const layoutScrollRestoreRef = useRef<TopologyScrollRestore | null>(null);
  const previousCodeViewKeyRef = useRef<string | null>(null);
  const [inlineRenderFailed, setInlineRenderFailed] = useState(false);
  const [workerUnavailable, setWorkerUnavailable] = useState(false);
  /**
   * 命令式 updateItem / 折叠会改 parsedItemListRef，但不改 inputs。
   * epoch 迫使 codeViewItems 重新读取权威列表，供 layout remount 的 initialItems 使用。
   */
  const [itemEpoch, setItemEpoch] = useState(0);
  const bumpItemEpoch = useCallback(() => {
    setItemEpoch((current) => current + 1);
  }, []);
  /** 文件 host 标记 data-pier-file-host，供 CSS :hover 显示 hunk pills。 */
  const fileHoverCleanupsRef = useRef(new Map<string, () => void>());
  const fileHoverHostsRef = useRef(new Map<string, HTMLElement>());
  // 菜单打开瞬间的选区文本快照（浏览器字符选区优先；行选模型回退）。
  const selectedTextRef = useRef("");
  const disableWorkerPool = useCallback(() => {
    setWorkerUnavailable(true);
  }, []);
  const parsed = useMemo(
    () => toCodeViewItems(inputs, parsedItemsRef.current),
    [inputs]
  );
  const inputStore = useDiffViewInputStore(inputs);
  useLayoutEffect(() => {
    onItemErrorRef.current = onItemError;
  }, [onItemError]);
  useEffect(() => {
    const currentIds = new Set(inputs.map((input) => input.id));
    for (const id of collapsedItemsRef.current.keys()) {
      if (!currentIds.has(id)) {
        collapsedItemsRef.current.delete(id);
      }
    }
  }, [inputs]);
  // itemEpoch：折叠 / 命令式 updateItems 后强制刷新（读 ref，linter 看不到）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: itemEpoch is intentional recompute trigger
  const codeViewItems = useMemo(() => {
    // 权威列表：已成功 apply 的 parsedItemList（含折叠与增量正文）。
    if (
      parsedInputsRef.current === inputs &&
      parsedItemListRef.current.length > 0
    ) {
      return parsedItemListRef.current;
    }
    return applyCollapseIntentToItems(
      parsed.items,
      collapsedItemsRef.current,
      collapseAllIntentRef.current
    );
  }, [inputs, itemEpoch, parsed.items]);
  const metrics = useMemo(
    () => diffMetrics(appearance.codeFontSize),
    [appearance.codeFontSize]
  );
  const renderMode = workerUnavailable ? "inline" : "worker";
  // Remount on layout + theme only (not item membership). Theme is required:
  // Pierre onThemeChange only invalidates the pool without re-rendering.
  const themeKey = pierDiffThemeKey(appearance);
  const codeViewKey = pierDiffCodeViewKey({
    diffStyle,
    lineHeight: metrics.lineHeight,
    overflow,
    renderMode,
    themeKey,
  });
  // Capture while the previous CodeView instance is still mounted (render phase).
  captureTopologyScrollRestore({
    codeViewRef,
    inputs,
    previousTopologyKey: previousCodeViewKeyRef.current,
    topologyKey: codeViewKey,
    topologyScrollRestoreRef: layoutScrollRestoreRef,
  });
  previousCodeViewKeyRef.current = codeViewKey;
  const renderEnvironment = useMemo(
    () =>
      pierDiffRenderEnvironment({
        diffStyle,
        lineHeight: metrics.lineHeight,
        metricsDiffHeaderHeight: metrics.headerHeight,
        overflow,
        renderMode,
        themeKey,
      }),
    [diffStyle, metrics, overflow, renderMode, themeKey]
  );
  const getRenderedItems = useCallback(
    () => codeViewRef.current?.getInstance()?.getRenderedItems() ?? [],
    []
  );
  const getContainer = useCallback(
    () => codeViewRef.current?.getInstance()?.getContainerElement(),
    []
  );
  const {
    auditVisibleItems,
    expectItemRender,
    markRendered,
    pendingRenderKey,
  } = useDiffRenderWatchdog(renderEnvironment, codeViewItems, getRenderedItems);
  const isUserCollapsed = useUserCollapsedPredicate(
    collapsedItemsRef,
    collapseAllIntentRef
  );
  const scheduleRenderWindowReport = useDiffRenderWindowReport(
    getContainer,
    getRenderedItems,
    onRenderWindowChange
  );
  const { activateGutterReview, options, renderAnnotation, style } =
    useDiffViewCodeOptions({
      appearance,
      codeViewRef,
      collapseAllIntentRef,
      diffStyle,
      fileHoverCleanupsRef,
      fileHoverHostsRef,
      inputStore,
      isUserCollapsed,
      labels,
      markRendered,
      metrics,
      ...(driftCommentLabels === undefined ? {} : { driftCommentLabels }),
      ...(onGutterReviewActivate === undefined
        ? {}
        : { onGutterReviewActivate }),
      ...(onHunkAction === undefined ? {} : { onHunkAction }),
      overflow,
      ...(reviewCommentsById === undefined ? {} : { reviewCommentsById }),
      scheduleRenderWindowReport,
      ...(inlineReviewHandlers === undefined ? {} : { inlineReviewHandlers }),
      ...(inlineReviewLabels === undefined ? {} : { inlineReviewLabels }),
      ...(inlineReviewThreadById === undefined
        ? {}
        : { inlineReviewThreadById }),
      ...(locale === undefined ? {} : { locale }),
    });

  useEffect(
    () => () => {
      for (const cleanup of fileHoverCleanupsRef.current.values()) {
        cleanup();
      }
      fileHoverCleanupsRef.current.clear();
      fileHoverHostsRef.current.clear();
    },
    []
  );

  const {
    handleCodeViewScroll,
    handleHeaderClickCapture,
    handleUserScrollIntent,
    handleUserScrollKey,
    renderHeaderMetadata,
    renderHeaderPrefix,
    setItemCollapsed,
  } = useDiffViewHeaders({
    appliedItemsRef,
    auditVisibleItems,
    bumpItemEpoch,
    codeViewItems,
    codeViewRef,
    collapseAllIntentRef,
    collapsedItemsRef,
    expectItemRender,
    inputStore,
    isUserCollapsed,
    labels,
    ...(driftCommentLabels === undefined ? {} : { driftCommentLabels }),
    metrics,
    onScroll,
    ...(onDiscardFile === undefined ? {} : { onDiscardFile }),
    ...(onDriftCommentActivate === undefined ? {} : { onDriftCommentActivate }),
    ...(onOpenFile === undefined ? {} : { onOpenFile }),
    ...(onRetryItem === undefined ? {} : { onRetryItem }),
    ...(onToggleStage === undefined ? {} : { onToggleStage }),
    parsedItemIndexesRef,
    parsedItemListRef,
    parsedItemsRef,
    renderItemIdentitiesRef,
    scheduleRenderWindowReport,
  });
  const { handleContextMenuCapture, handlePointerDownCapture } =
    useDiffViewContentSelection({
      appliedItemsRef,
      codeViewRef,
      ...(onGutterReviewActivate === undefined
        ? {}
        : { onGutterLineActivate: activateGutterReview }),
      onPointerIntent: handleUserScrollIntent,
      parsedItemsRef,
      selectedTextRef,
    });

  // membership 拓扑变：apply 内 render(true) 同步 Pierre 行锚；禁止 item 级 scrollTo。
  useDiffViewItemApply({
    appliedItemsRef,
    bumpItemEpoch,
    codeViewItems,
    codeViewKey,
    codeViewRef,
    firstLayoutItemIdsRef,
    inputs,
    onError,
    parsedCache: parsed.cache,
    parsedInputRef: parsedInputsRef,
    parsedItemIndexesRef,
    parsedItemListRef,
    parsedItemsRef,
    renderItemIdentitiesRef,
    scheduleRenderWindowReport,
    ...(getSuppressMembershipScrollRestore === undefined
      ? {}
      : { getSuppressMembershipScrollRestore }),
    suppressMembershipScrollRestore,
  });

  // 行内评论激活态：apply 层推 base（hunk-only）后，命令式 updateItem 合并
  // review annotation（合并 effect 见 useDiffViewReviewAnnotationMerge）。
  useDiffViewReviewAnnotationMerge({
    activeReviewEpoch,
    activeReviewSlotsByItem,
    codeViewItems,
    codeViewRef,
  });

  useLayoutEffect(() => {
    if (codeViewKey.length >= 0 && codeViewItems.length >= 0) {
      stabilizeCodeViewStickyPositioning(codeViewRef.current?.getInstance());
    }
  }, [codeViewItems, codeViewKey]);

  useLayoutEffect(() => {
    restoreTopologyScroll({
      codeViewItemsLength: codeViewItems.length,
      codeViewKey,
      codeViewRef,
      inputs,
      scheduleRenderWindowReport,
      topologyScrollRestoreRef: layoutScrollRestoreRef,
    });
  }, [codeViewItems, codeViewKey, inputs, scheduleRenderWindowReport]);

  useEffect(() => {
    if (codeViewItems.length === 0 || pendingRenderKey === null) {
      return;
    }
    const timeout = setTimeout(() => {
      if (renderMode === "worker") {
        disableWorkerPool();
        return;
      }
      setInlineRenderFailed(true);
      onError(
        new Error("Pierre did not render the diff after the worker fallback.")
      );
    }, INLINE_RENDER_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [
    codeViewItems.length,
    disableWorkerPool,
    onError,
    pendingRenderKey,
    renderMode,
  ]);

  useDiffViewHandle({
    appliedItemsRef,
    auditVisibleItems,
    bumpItemEpoch,
    codeViewRef,
    collapseAllIntentRef,
    collapsedItemsRef,
    expectItemRender,
    firstLayoutItemIdsRef,
    isUserCollapsed,
    itemErrorIdsRef,
    metrics,
    onItemErrorRef,
    parsedItemIndexesRef,
    parsedItemListRef,
    parsedItemsRef,
    ref,
    renderItemIdentitiesRef,
    scheduleRenderWindowReport,
    selectedTextRef,
    setItemCollapsed,
  });

  useEffect(() => {
    if (!onItemError) {
      return;
    }
    const nextIds = new Set(parsed.errors.map((item) => item.id));
    for (const item of parsed.errors) {
      onItemError(item.id, item.error);
    }
    for (const id of itemErrorIdsRef.current) {
      if (!nextIds.has(id)) {
        onItemError(id, null);
      }
    }
    itemErrorIdsRef.current = nextIds;
  }, [onItemError, parsed.errors]);

  if (inlineRenderFailed) {
    return null;
  }
  return (
    <PierDiffViewShell
      codeThemes={appearance.codeThemes}
      codeViewItems={codeViewItems}
      codeViewKey={codeViewKey}
      codeViewRef={codeViewRef}
      handleCodeViewScroll={handleCodeViewScroll}
      handleContextMenuCapture={handleContextMenuCapture}
      handleHeaderClickCapture={handleHeaderClickCapture}
      handlePointerDownCapture={handlePointerDownCapture}
      handleUserScrollIntent={handleUserScrollIntent}
      handleUserScrollKey={handleUserScrollKey}
      onError={onError}
      onUnavailable={disableWorkerPool}
      options={options}
      {...(onHunkAction ||
      inlineReviewHandlers !== undefined ||
      onGutterReviewActivate
        ? { renderAnnotation }
        : {})}
      renderHeaderMetadata={renderHeaderMetadata}
      renderHeaderPrefix={renderHeaderPrefix}
      style={style}
      workerUnavailable={workerUnavailable}
    />
  );
}
