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
import type { PierDiffViewLabels } from "./diff-view-collapse.tsx";
import {
  type ParsedItemCacheEntry,
  type PierDiffViewItem,
  toCodeViewItems,
} from "./diff-view-items.ts";
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
import { useDiffViewHeaders } from "./use-diff-view-headers.tsx";
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
  const {
    handleCodeViewScroll,
    handleUserScrollKey,
    renderHeaderMetadata,
    renderHeaderPrefix,
    setItemCollapsed,
  } = useDiffViewHeaders({
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
  });

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
