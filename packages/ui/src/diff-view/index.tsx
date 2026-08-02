import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
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
  pierDiffRenderEnvironment,
  pierDiffThemeKey,
} from "./appearance.ts";
import type { PierDiffViewLabels } from "./collapse.tsx";
import type {
  PierHunkActionEvent,
  PierHunkAnnotationMetadata,
} from "./hunk-actions.tsx";
import { useDiffViewInputStore } from "./input-store.ts";
import {
  type ParsedItemCacheEntry,
  type PierDiffViewItem,
  toCodeViewItems,
} from "./items.ts";
import type { DiffPointerLineHit } from "./pointer-selection.ts";
import { useDiffRenderWatchdog } from "./render-watchdog.ts";
import {
  type PierDiffViewRenderWindow,
  useDiffRenderWindowReport,
} from "./render-window.ts";
import { stabilizeCodeViewStickyPositioning } from "./sticky-stabilize.ts";
import {
  captureTopologyScrollRestore,
  restoreTopologyScroll,
  type TopologyScrollRestore,
} from "./topology-scroll.ts";
import { useDiffViewCodeOptions } from "./use-code-options.ts";
import { useDiffViewContentSelection } from "./use-content-selection.ts";
import {
  type DiffViewCollapsedItemState,
  type DiffViewRenderItemIdentity,
  type PierDiffViewHandle,
  useDiffViewHandle,
} from "./use-handle.ts";
import { useDiffViewHeaders } from "./use-headers.tsx";
import { useDiffViewItemApply } from "./use-item-apply.ts";
import { PierDiffViewShell } from "./view-shell.tsx";

export interface PierDiffViewAppearance {
  readonly codeFontFamily: string;
  /** Resolved code body size, e.g. "13px" from settings `codeFontSize`. */
  readonly codeFontSize: string;
  /**
   * Dual Shiki theme names for the current style preset.
   * Pierre dual-theme mode: tokens use CSS variables; {@link colorMode}
   * selects light/dark without re-tokenizing.
   */
  readonly codeThemes: {
    readonly dark: string;
    readonly light: string;
  };
  readonly colorMode: "dark" | "light";
}

export type {
  PierDiffViewChangeControl,
  PierDiffViewFileDisplay,
  PierDiffViewItem,
  PierDiffViewStageControl,
} from "./items.ts";
export {
  estimateLinesForFileStatus,
  PIER_DIFF_DEFAULT_ESTIMATE_LINES,
  PIER_DIFF_ESTIMATE_SLOT_HEIGHT_PX,
  PIER_DIFF_MAX_ESTIMATE_BODY_LINES,
} from "./items.ts";
export type { PierDiffViewRenderWindow } from "./render-window.ts";
export {
  fullSelectionRangeForCodeViewItem,
  selectedLinesTextFromCodeViewItem,
} from "./selection-text.ts";
export type {
  PierDiffViewAnchor,
  PierDiffViewHandle,
  PierDiffViewUpdateOptions,
} from "./use-handle.ts";
export interface PierDiffViewPresentation {
  readonly diffStyle: "split" | "unified";
  readonly wrapLines: boolean;
}
export type {
  PierHunkActionEvent,
  PierHunkAnnotationMetadata,
} from "./hunk-actions.tsx";

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
  /**
   * error 槽行内重试（document materialize 失败等）；
   * 与 `labels.retry` 同时提供时 header 显示 Retry。
   */
  readonly onRetryItem?: (itemId: string) => void;
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
  onRetryItem,
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
        metricsDiffHeaderHeight: metrics.diffHeaderHeight,
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
    ...(onRetryItem === undefined ? {} : { onRetryItem }),
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
  return (
    <PierDiffViewShell
      codeThemes={appearance.codeThemes}
      codeViewItems={codeViewItems}
      codeViewKey={codeViewKey}
      codeViewRef={codeViewRef}
      handleCodeViewScroll={handleCodeViewScroll}
      handleHeaderClickCapture={handleHeaderClickCapture}
      handlePointerDownCapture={handlePointerDownCapture}
      handleUserScrollIntent={handleUserScrollIntent}
      handleUserScrollKey={handleUserScrollKey}
      onError={onError}
      onUnavailable={disableWorkerPool}
      options={options}
      {...(onHunkAction ? { renderAnnotation } : {})}
      renderHeaderMetadata={renderHeaderMetadata}
      renderHeaderPrefix={renderHeaderPrefix}
      style={style}
      workerUnavailable={workerUnavailable}
    />
  );
}
