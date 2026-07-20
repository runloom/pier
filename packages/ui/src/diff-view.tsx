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
import {
  clearBrowserTextSelection,
  type DiffPointerLineHit,
  resolveDiffPointerLineHit,
  selectionFromPointerDrag,
} from "./diff-view-pointer-selection.ts";
import { useDiffRenderWatchdog } from "./diff-view-render-watchdog.ts";
import {
  type PierDiffViewRenderWindow,
  useDiffRenderWindowReport,
} from "./diff-view-render-window.ts";
import { selectedLinesTextFromCodeViewItem } from "./diff-view-selection-text.ts";
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

export interface PierDiffViewProps {
  readonly appearance: PierDiffViewAppearance;
  readonly items: readonly PierDiffViewItem[];
  readonly labels: PierDiffViewLabels;
  readonly onError: (error: Error) => void;
  readonly onItemError?: (id: string, error: Error | null) => void;
  readonly onRenderWindowChange?: (window: PierDiffViewRenderWindow) => void;
  readonly onScroll?: () => void;
  /** 缺省 split + 不换行(既有行为)。变更会强制 CodeView 重建。 */
  readonly presentation?: PierDiffViewPresentation;
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
  presentation,
  ref,
}: PierDiffViewProps): React.JSX.Element | null {
  const diffStyle = presentation?.diffStyle ?? "split";
  const overflow = presentation?.wrapLines === true ? "wrap" : "scroll";
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
  // selection=uncontrolled 钉进 key：避免 HMR 从旧受控实例切过来时
  // CodeView 拒绝 controlled→uncontrolled 并卡死选区。
  // diffStyle/overflow 影响行高与布局缓存，切换时强制重建实例。
  const codeViewKey = `${renderMode}\0selection=uncontrolled\0${diffStyle}\0${overflow}\0${topologyKey}`;
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
  const snapshotSelectedText = useCallback(() => {
    const selection = codeViewRef.current?.getSelectedLines();
    if (!selection) {
      return;
    }
    const item =
      codeViewRef.current?.getItem(selection.id) ??
      appliedItemsRef.current?.items.get(selection.id) ??
      parsedItemsRef.current.get(selection.id)?.item;
    const text = selectedLinesTextFromCodeViewItem(item, selection.range);
    if (text.length > 0) {
      selectedTextRef.current = text;
    }
  }, []);

  const handlePointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const viewer = codeViewRef.current;
      if (!viewer) {
        return;
      }

      // 右键：只快照 live 行选区，绝不触发 onScroll。
      if (event.button === 2) {
        snapshotSelectedText();
        return;
      }
      if (event.button !== 0) {
        return;
      }

      const hit = resolveDiffPointerLineHit(event.nativeEvent, viewer);
      if (!hit) {
        return;
      }

      // 行号栏交给 Pierre 原生 line selection；正文拖必须映射到同一套行选，
      // 并阻断浏览器蓝选（截图里第 8 行高亮 vs 11-17 蓝选两套并存）。
      clearBrowserTextSelection();
      if (hit.fromNumberColumn) {
        return;
      }

      event.preventDefault();
      contentDragAnchorRef.current = hit;
      viewer.setSelectedLines({
        id: hit.id,
        range: {
          end: hit.lineNumber,
          side: hit.side,
          start: hit.lineNumber,
        },
      });
      snapshotSelectedText();

      const handleMove = (moveEvent: PointerEvent) => {
        const anchor = contentDragAnchorRef.current;
        const currentViewer = codeViewRef.current;
        if (!(anchor && currentViewer)) {
          return;
        }
        moveEvent.preventDefault();
        clearBrowserTextSelection();
        const current = resolveDiffPointerLineHit(moveEvent, currentViewer);
        if (!current) {
          return;
        }
        const next = selectionFromPointerDrag(anchor, current);
        if (!next) {
          return;
        }
        currentViewer.setSelectedLines(next);
      };
      const handleUp = () => {
        contentDragAnchorRef.current = null;
        snapshotSelectedText();
        clearBrowserTextSelection();
        window.removeEventListener("pointermove", handleMove, true);
        window.removeEventListener("pointerup", handleUp, true);
        window.removeEventListener("pointercancel", handleUp, true);
      };
      window.addEventListener("pointermove", handleMove, true);
      window.addEventListener("pointerup", handleUp, true);
      window.addEventListener("pointercancel", handleUp, true);
    },
    [snapshotSelectedText]
  );
  const options = useMemo<CodeViewOptions<undefined>>(
    () => ({
      diffIndicators: "bars",
      diffStyle,
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
      overflow,
      preferredHighlighter: "shiki-wasm",
      stickyHeaders: true,
      theme: appearance.codeTheme,
      themeType: appearance.colorMode,
      unsafeCSS: CODE_VIEW_CUSTOM_CSS,
    }),
    [
      appearance.codeTheme,
      appearance.colorMode,
      diffStyle,
      markRendered,
      metrics,
      overflow,
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
      "--diffs-scrollbar-gutter-override":
        "var(--shell-scrollbar-width-legacy)",
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
      onPointerDownCapture={handlePointerDownCapture}
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
