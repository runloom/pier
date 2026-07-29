import {
  CodeView,
  type CodeViewHandle,
  type CodeViewItem,
} from "@pierre/diffs/react";
import {
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  diffFontMetrics,
  ensurePierDiffLightDomStyles,
  pierDiffCodeViewKey,
} from "./diff-view-appearance.ts";
import type { PierDiffViewLabels } from "./diff-view-collapse.tsx";
import type {
  PierHunkActionEvent,
  PierHunkAnnotationMetadata,
} from "./diff-view-hunk-actions.tsx";
import { useDiffViewInputStore } from "./diff-view-input-store.ts";
import {
  type ParsedItemCacheEntry,
  type PierDiffViewItem,
  toCodeViewItems,
} from "./diff-view-items.ts";
import type { DiffPointerLineHit } from "./diff-view-pointer-selection.ts";
import { useDiffRenderWatchdog } from "./diff-view-render-watchdog.ts";
import {
  type PierDiffViewRenderWindow,
  useDiffRenderWindowReport,
} from "./diff-view-render-window.ts";
import { stabilizeCodeViewStickyPositioning } from "./diff-view-sticky-stabilize.ts";
import {
  captureTopologyScrollRestore,
  restoreTopologyScroll,
  type TopologyScrollRestore,
} from "./diff-view-topology-scroll.ts";
import { PierDiffWorkerProvider } from "./diff-view-worker.tsx";
import { useDiffViewCodeOptions } from "./use-diff-view-code-options.ts";
import { useDiffViewContentSelection } from "./use-diff-view-content-selection.ts";
import {
  type DiffViewCollapsedItemState,
  type DiffViewRenderItemIdentity,
  type PierDiffViewHandle,
  useDiffViewHandle,
} from "./use-diff-view-handle.ts";
import { useDiffViewHeaders } from "./use-diff-view-headers.tsx";
import { useDiffViewItemApply } from "./use-diff-view-item-apply.ts";

export interface PierDiffViewAppearance {
  readonly codeFontFamily: string;
  /** Resolved code body size, e.g. "13px" from settings `codeFontSize`. */
  readonly codeFontSize: string;
  readonly codeTheme: string;
  readonly colorMode: "dark" | "light";
}

export type {
  PierDiffViewChangeControl,
  PierDiffViewFileDisplay,
  PierDiffViewItem,
  PierDiffViewStageControl,
} from "./diff-view-items.ts";
export {
  estimateLinesForFileStatus,
  PIER_DIFF_DEFAULT_ESTIMATE_LINES,
  PIER_DIFF_ESTIMATE_SLOT_HEIGHT_PX,
  PIER_DIFF_MAX_ESTIMATE_BODY_LINES,
} from "./diff-view-items.ts";
export type { PierDiffViewRenderWindow } from "./diff-view-render-window.ts";
export {
  fullSelectionRangeForCodeViewItem,
  selectedLinesTextFromCodeViewItem,
} from "./diff-view-selection-text.ts";
export type {
  PierDiffViewAnchor,
  PierDiffViewHandle,
  PierDiffViewUpdateOptions,
} from "./use-diff-view-handle.ts";
export interface PierDiffViewPresentation {
  readonly diffStyle: "split" | "unified";
  readonly wrapLines: boolean;
}
export type {
  PierHunkActionEvent,
  PierHunkAnnotationMetadata,
} from "./diff-view-hunk-actions.tsx";

export interface PierDiffViewProps {
  readonly appearance: PierDiffViewAppearance;
  /**
   * 同步闸门（layout 可读）：与 pendingNavigationRef 同源，
   * 避免仅依赖 React state 时同帧 membership apply 漏 suppress。
   */
  readonly getSuppressMembershipScrollRestore?: () => boolean;
  readonly items: readonly PierDiffViewItem[];
  readonly labels: PierDiffViewLabels;
  /** Discard unstaged working-tree changes for a multi-diff item id. */
  readonly onDiscardFile?: (itemId: string) => void;
  readonly onError: (error: Error) => void;
  /**
   * Codex-style per-hunk Stage / Unstage / Revert (Pierre annotations +
   * renderAnnotation). When set, items with changeControls get block toolbars.
   */
  readonly onHunkAction?: (event: PierHunkActionEvent) => void;
  readonly onItemError?: (id: string, error: Error | null) => void;
  /** Open the file for a multi-diff item id (header title click). */
  readonly onOpenFile?: (itemId: string) => void;
  readonly onRenderWindowChange?: (window: PierDiffViewRenderWindow) => void;
  readonly onScroll?: () => void;
  /** Toggle uncommitted stage for a canonical multi-diff item id (entryKey). */
  readonly onToggleStage?: (itemId: string) => void;
  /** 缺省 split + 不换行(既有行为)。变更会强制 CodeView 重建。 */
  readonly presentation?: PierDiffViewPresentation;
  readonly ref?: Ref<PierDiffViewHandle>;
  /**
   * 树导航 pending 时禁止成员变更后的 scrollTop 硬恢复，
   * 避免与 scrollTo(target) 双意图（full-alignment K5）。
   */
  readonly suppressMembershipScrollRestore?: boolean;
}

const INLINE_RENDER_TIMEOUT_MS = 10_000;
export function PierDiffView({
  appearance,
  items: inputs,
  labels,
  onDiscardFile,
  onError,
  onHunkAction,
  onItemError,
  onOpenFile,
  onRenderWindowChange,
  onScroll,
  onToggleStage,
  presentation,
  ref,
  getSuppressMembershipScrollRestore,
  suppressMembershipScrollRestore = false,
}: PierDiffViewProps): React.JSX.Element | null {
  const diffStyle = presentation?.diffStyle ?? "split";
  const overflow = presentation?.wrapLines === true ? "wrap" : "scroll";
  const codeViewRef = useRef<CodeViewHandle<PierHunkAnnotationMetadata>>(null);
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
  const parsedItemIndexesRef = useRef(new Map<string, number>());
  const parsedItemListRef = useRef<CodeViewItem<PierHunkAnnotationMetadata>[]>(
    []
  );
  const parsedInputsRef = useRef<readonly PierDiffViewItem[] | null>(null);
  const appliedItemsRef = useRef<{
    readonly key: string;
    readonly items: Map<string, CodeViewItem<PierHunkAnnotationMetadata>>;
  } | null>(null);
  /** 最近一次 membership apply 新建的 item id；scrollToItem 用 instant。 */
  const firstLayoutItemIdsRef = useRef(new Set<string>());
  /**
   * 仅布局不变量（lineHeight/diffStyle/…）触发 remount 时恢复视口。
   * 成员/stage 变更不 remount，不走此路径。
   */
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
  // 菜单打开瞬间的 live 选区文本快照（非受控选区源；Pierre 内部才是真相）。
  const selectedTextRef = useRef("");
  const contentDragAnchorRef = useRef<DiffPointerLineHit | null>(null);
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
    return parsed.items.map((item) => {
      const collapsed = collapsedItemsRef.current.get(item.id);
      if (!collapsed) {
        return item;
      }
      return {
        ...item,
        collapsed: collapsed.collapsed,
        version:
          (typeof item.version === "number" ? item.version : 0) +
          collapsed.revision,
      };
    });
  }, [inputs, itemEpoch, parsed.items]);
  const metrics = useMemo(
    () => diffFontMetrics(appearance.codeFontSize),
    [appearance.codeFontSize]
  );
  const renderMode = workerUnavailable ? "inline" : "worker";
  // selection=uncontrolled 钉进 key：避免 HMR 从旧受控实例切过来时
  // CodeView 拒绝 controlled→uncontrolled 并卡死选区。
  // diffStyle/overflow/lineHeight（含 codeFontSize）影响行高与布局缓存，切换时强制重建实例。
  // 成员 id 集合变化不 remount：由 syncCodeViewItems（addItems/setItems）消化。
  const codeViewKey = pierDiffCodeViewKey({
    diffStyle,
    lineHeight: metrics.lineHeight,
    overflow,
    renderMode,
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
      `${renderMode}\0${appearance.codeTheme}\0${appearance.colorMode}\0${metrics.diffHeaderHeight}\0${metrics.lineHeight}\0${diffStyle}\0${overflow}`,
    [
      appearance.codeTheme,
      appearance.colorMode,
      diffStyle,
      metrics.diffHeaderHeight,
      metrics.lineHeight,
      overflow,
      renderMode,
    ]
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
  const scheduleRenderWindowReport = useDiffRenderWindowReport(
    getContainer,
    getRenderedItems,
    onRenderWindowChange
  );
  const { options, renderAnnotation, style } = useDiffViewCodeOptions({
    appearance,
    codeViewRef,
    diffStyle,
    fileHoverCleanupsRef,
    fileHoverHostsRef,
    inputStore,
    labels,
    markRendered,
    metrics,
    ...(onHunkAction === undefined ? {} : { onHunkAction }),
    overflow,
    scheduleRenderWindowReport,
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
    collapsedItemsRef,
    expectItemRender,
    inputStore,
    labels,
    onScroll,
    ...(onDiscardFile === undefined ? {} : { onDiscardFile }),
    ...(onOpenFile === undefined ? {} : { onOpenFile }),
    ...(onToggleStage === undefined ? {} : { onToggleStage }),
    parsedItemIndexesRef,
    parsedItemListRef,
    parsedItemsRef,
    renderItemIdentitiesRef,
    scheduleRenderWindowReport,
  });
  const { handlePointerDownCapture } = useDiffViewContentSelection({
    appliedItemsRef,
    codeViewRef,
    contentDragAnchorRef,
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
  const codeView = (
    <CodeView
      className="cv-scrollbar relative h-full min-h-0 w-full min-w-0 flex-1 overflow-auto overscroll-contain border-border border-b [contain:strict] [overflow-anchor:none] [scrollbar-gutter:auto] [will-change:scroll-position] md:border-b-0 [&_diffs-container]:overflow-x-visible [&_diffs-container]:shadow-[0_-1px_0_var(--diffshub-diff-separator,var(--color-border-opaque)),0_1px_0_var(--diffshub-diff-separator,var(--color-border-opaque))] [&_diffs-container]:[contain:layout_paint_style]"
      data-scrollbar="overlay"
      disableWorkerPool={workerUnavailable}
      initialItems={codeViewItems}
      key={codeViewKey}
      onScroll={handleCodeViewScroll}
      options={options}
      ref={codeViewRef}
      // Writable review only: Pierre fills annotation slots when this prop is set.
      {...(onHunkAction ? { renderAnnotation } : {})}
      renderHeaderMetadata={renderHeaderMetadata}
      renderHeaderPrefix={renderHeaderPrefix}
      style={style}
    />
  );

  return (
    <div
      className="h-full"
      data-testid="pierre-diff-root"
      onClickCapture={handleHeaderClickCapture}
      onKeyDownCapture={handleUserScrollKey}
      onPointerDownCapture={handlePointerDownCapture}
      onTouchMoveCapture={handleUserScrollIntent}
      onWheelCapture={handleUserScrollIntent}
    >
      {workerUnavailable ? (
        codeView
      ) : (
        <PierDiffWorkerProvider
          onError={onError}
          onUnavailable={disableWorkerPool}
          theme={appearance.codeTheme}
        >
          {codeView}
        </PierDiffWorkerProvider>
      )}
    </div>
  );
}
