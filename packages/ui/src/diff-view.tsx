import type { CodeViewOptions } from "@pierre/diffs";
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
  CODE_VIEW_CUSTOM_CSS,
  type DiffTypographyStyle,
  diffFontMetrics,
} from "./diff-view-appearance.ts";
import {
  CollapseDiffButton,
  type PierDiffViewLabels,
} from "./diff-view-collapse.tsx";
import {
  fileDiffLineStats,
  type ParsedItemCacheEntry,
  type PierDiffViewItem,
  toCodeViewItems,
} from "./diff-view-items.ts";
import {
  pierDiffItemPresentation,
  shouldRenderDiffLineStats,
} from "./diff-view-presentation.ts";
import { useDiffRenderWatchdog } from "./diff-view-render-watchdog.ts";
import {
  type PierDiffViewRenderWindow,
  useDiffRenderWindowReport,
} from "./diff-view-render-window.ts";
import { PierDiffWorkerProvider } from "./diff-view-worker.tsx";
import {
  type DiffViewCollapsedItemState,
  type DiffViewRenderItemIdentity,
  type PierDiffViewHandle,
  useDiffViewHandle,
} from "./use-diff-view-handle.ts";
import { useDiffViewItemApply } from "./use-diff-view-item-apply.ts";

export interface PierDiffViewAppearance {
  readonly baseFontSize: string;
  readonly codeFontFamily: string;
  readonly codeTheme: string;
  readonly colorMode: "dark" | "light";
}

export type {
  PierDiffViewFileDisplay,
  PierDiffViewItem,
} from "./diff-view-items.ts";
export type { PierDiffViewRenderWindow } from "./diff-view-render-window.ts";
export type {
  PierDiffViewAnchor,
  PierDiffViewHandle,
  PierDiffViewUpdateOptions,
} from "./use-diff-view-handle.ts";
export interface PierDiffViewProps {
  readonly appearance: PierDiffViewAppearance;
  readonly items: readonly PierDiffViewItem[];
  readonly labels: PierDiffViewLabels;
  readonly onError: (error: Error) => void;
  readonly onItemError?: (id: string, error: Error | null) => void;
  readonly onRenderWindowChange?: (window: PierDiffViewRenderWindow) => void;
  readonly onScroll?: () => void;
  readonly ref?: Ref<PierDiffViewHandle>;
}

const INLINE_RENDER_TIMEOUT_MS = 10_000;
const USER_SCROLL_KEYS = new Set([
  " ",
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

export function PierDiffView({
  appearance,
  items: inputs,
  labels,
  onError,
  onItemError,
  onRenderWindowChange,
  onScroll,
  ref,
}: PierDiffViewProps): React.JSX.Element | null {
  const codeViewRef = useRef<CodeViewHandle<undefined>>(null);
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
  const parsedItemListRef = useRef<CodeViewItem[]>([]);
  const parsedInputsRef = useRef<readonly PierDiffViewItem[] | null>(null);
  const appliedItemsRef = useRef<{
    readonly key: string;
    readonly items: Map<string, CodeViewItem>;
  } | null>(null);
  const [inlineRenderFailed, setInlineRenderFailed] = useState(false);
  const [workerUnavailable, setWorkerUnavailable] = useState(false);
  const disableWorkerPool = useCallback(() => {
    setWorkerUnavailable(true);
  }, []);
  const parsed = useMemo(
    () => toCodeViewItems(inputs, parsedItemsRef.current),
    [inputs]
  );
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
  const codeViewItems = useMemo(() => {
    if (parsedInputsRef.current === inputs) {
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
  }, [inputs, parsed.items]);
  const topologyKey = useMemo(
    () => JSON.stringify(codeViewItems.map((item) => item.id)),
    [codeViewItems]
  );
  const metrics = useMemo(
    () => diffFontMetrics(appearance.baseFontSize),
    [appearance.baseFontSize]
  );
  const renderMode = workerUnavailable ? "inline" : "worker";
  const codeViewKey = `${renderMode}\0${topologyKey}`;
  const renderEnvironment = useMemo(
    () =>
      `${renderMode}\0${appearance.codeTheme}\0${appearance.colorMode}\0${metrics.diffHeaderHeight}\0${metrics.lineHeight}`,
    [
      appearance.codeTheme,
      appearance.colorMode,
      metrics.diffHeaderHeight,
      metrics.lineHeight,
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
  const options = useMemo<CodeViewOptions<undefined>>(
    () => ({
      diffIndicators: "bars",
      diffStyle: "split",
      disableBackground: false,
      disableLineNumbers: false,
      enableGutterUtility: false,
      enableLineSelection: true,
      itemMetrics: {
        diffHeaderHeight: metrics.diffHeaderHeight,
        lineHeight: metrics.lineHeight,
      },
      layout: { gap: 1, paddingBottom: 0, paddingTop: 0 },
      lineHoverHighlight: "number",
      onPostRender(element, _instance, phase, context) {
        if (phase !== "unmount") {
          markRendered(context.item.id, context.version, element);
        }
        scheduleRenderWindowReport();
      },
      overflow: "scroll",
      preferredHighlighter: "shiki-wasm",
      stickyHeaders: true,
      theme: appearance.codeTheme,
      themeType: appearance.colorMode,
      unsafeCSS: CODE_VIEW_CUSTOM_CSS,
    }),
    [
      appearance.codeTheme,
      appearance.colorMode,
      markRendered,
      metrics,
      scheduleRenderWindowReport,
    ]
  );
  const style = useMemo<DiffTypographyStyle>(
    () => ({
      "--diffshub-annotation-border": "var(--border)",
      "--diffshub-diff-separator": "var(--border)",
      "--diffs-font-family": appearance.codeFontFamily,
      "--diffs-font-size": "0.8125rem",
      "--diffs-line-height": "1.75",
      height: "100%",
    }),
    [appearance.codeFontFamily]
  );
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
    [auditVisibleItems, expectItemRender, scheduleRenderWindowReport]
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
    const map = new Map<string, (typeof inputs)[number]>();
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

  // 宿主接管增删统计：只渲染真实非零值。loading/空 ready 不显示 -0/+0。
  // 插槽内容在 light DOM，需自带 Pierre 变量色；官方直接子节点已被 CSS 隐藏。
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

  useDiffViewItemApply({
    appliedItemsRef,
    codeViewItems,
    codeViewKey,
    codeViewRef,
    inputs,
    onError,
    parsedCache: parsed.cache,
    parsedInputRef: parsedInputsRef,
    parsedItemIndexesRef,
    parsedItemListRef,
    parsedItemsRef,
    renderItemIdentitiesRef,
    scheduleRenderWindowReport,
  });

  useEffect(() => {
    if (codeViewItems.length === 0 || pendingRenderKey === null) {
      return;
    }
    const timeout = setTimeout(() => {
      if (renderMode === "worker") {
        disableWorkerPool();
        return;
      }
      const error = new Error(
        "Pierre did not render the diff after the worker fallback."
      );
      setInlineRenderFailed(true);
      onError(error);
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
      className="cv-scrollbar relative h-full min-h-0 w-full min-w-0 flex-1 overflow-auto overscroll-contain border-border border-b [contain:strict] [overflow-anchor:none] [will-change:scroll-position] md:border-b-0 [&_diffs-container]:overflow-x-visible [&_diffs-container]:shadow-[0_-1px_0_var(--diffshub-diff-separator,var(--color-border-opaque)),0_1px_0_var(--diffshub-diff-separator,var(--color-border-opaque))] [&_diffs-container]:[contain:layout_paint_style]"
      data-scrollbar="stable"
      disableWorkerPool={workerUnavailable}
      initialItems={codeViewItems}
      key={codeViewKey}
      onScroll={handleCodeViewScroll}
      options={options}
      ref={codeViewRef}
      renderHeaderMetadata={renderHeaderMetadata}
      renderHeaderPrefix={renderHeaderPrefix}
      style={style}
    />
  );

  return (
    <div
      className="h-full"
      data-testid="pierre-diff-root"
      onKeyDownCapture={handleUserScrollKey}
      onPointerDownCapture={onScroll}
      onTouchStartCapture={onScroll}
      onWheelCapture={onScroll}
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
