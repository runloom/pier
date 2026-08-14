import type { CodeViewOptions, SmoothScrollSettings } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import {
  createElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  CODE_VIEW_CUSTOM_CSS,
  type DiffTypographyStyle,
} from "./appearance.ts";
import type { PierDiffViewLabels } from "./collapse.tsx";
import type { DiffViewCollapseAllIntent } from "./collapse-intent.ts";
import {
  PIER_DIFF_ESTIMATE_ATTR,
  syncEstimateSkeleton,
} from "./estimate-skeleton.ts";
import { type DiffMetrics, slotVirtualHeight } from "./geometry.ts";
import {
  gutterReviewThreadForLine,
  type PierDriftCommentLabels,
  type PierGutterReviewEvent,
} from "./gutter/gutter-comments.tsx";
import {
  LiveHunkAnnotation,
  type PierHunkActionEvent,
  type PierHunkActionLabels,
} from "./hunk-actions.tsx";
import type { DiffViewInputStore } from "./input-store.ts";
import type { PierDiffReviewCommentThread } from "./items.ts";
import {
  estimatedContentLinesOf,
  installDiffVirtualHeightReconciler,
} from "./layout-apply.ts";
import { syncPathTitleChrome } from "./path-title-chrome.ts";
import { PIER_DIFF_LINE_DIFF_TYPE } from "./render-profile.ts";
import type { PierDiffAnnotationMetadata } from "./review/annotation-types.ts";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "./review/inline-comment-types.ts";
import { renderReviewAnnotation } from "./review/render-review-annotation.ts";
import { stabilizeCodeViewStickyPositioning } from "./sticky-stabilize.ts";

const DEFAULT_UNMODIFIED_LINE = "{{count}} unmodified line";
const DEFAULT_UNMODIFIED_LINES = "{{count}} unmodified lines";

/**
 * Build `CodeViewOptions.formatUnmodifiedLines` from host i18n templates.
 *
 * Plural selection is `count === 1` only (matches en/zh product needs). Callers
 * that need ICU few/many/zero must pass a pre-resolved formatter themselves via
 * `CodeViewOptions.formatUnmodifiedLines` instead of these templates.
 */
export function createFormatUnmodifiedLines(labels: {
  readonly unmodifiedLine?: string | undefined;
  readonly unmodifiedLines?: string | undefined;
}): (lines: number) => string {
  const singular = labels.unmodifiedLine ?? DEFAULT_UNMODIFIED_LINE;
  const plural = labels.unmodifiedLines ?? DEFAULT_UNMODIFIED_LINES;
  return (lines: number) => {
    const safe = Number.isFinite(lines) && lines >= 0 ? Math.floor(lines) : 0;
    const template = safe === 1 ? singular : plural;
    return template.replaceAll("{{count}}", String(safe));
  };
}

/**
 * Pierre 默认弹簧在超长列表的远距离导航中约需 0.9s 才进入目标视口。
 * 保留临界阻尼手感，同时把阅读导航收敛到约 0.4s。
 */
export const PIER_DIFF_VIEW_SMOOTH_SCROLL_SETTINGS: SmoothScrollSettings = {
  omega: 0.035,
  positionEpsilon: 0.5,
  velocityEpsilon: 0.05,
};

/**
 * 超大差异继续构造逐 token DOM 会连续阻塞主线程数百毫秒。
 * Pierre 在任一侧超过此行数时自动退化为纯文本，仍保留虚拟滚动与行级交互。
 */
export const PIER_DIFF_VIEW_TOKENIZE_MAX_LINES = 5000;

export function useDiffViewCodeOptions(options: {
  readonly appearance: {
    readonly codeFontFamily: string;
    readonly codeFontSize: string;
    /** Dual shiki names — Pierre CSS-variable dual-theme mode. */
    readonly codeThemes: {
      readonly dark: string;
      readonly light: string;
    };
    readonly colorMode: "dark" | "light";
  };
  readonly codeViewRef: RefObject<CodeViewHandle<PierDiffAnnotationMetadata> | null>;
  readonly collapseAllIntentRef: RefObject<DiffViewCollapseAllIntent>;
  readonly diffStyle: "split" | "unified";
  readonly fileHoverCleanupsRef: RefObject<Map<string, () => void>>;
  readonly fileHoverHostsRef: RefObject<Map<string, HTMLElement>>;
  readonly inputStore: DiffViewInputStore;
  /** 用户折叠意图（≠ estimate 的技术性默认折叠）。 */
  readonly isUserCollapsed: (itemId: string) => boolean;
  readonly labels: PierDiffViewLabels;
  readonly markRendered: (
    itemId: string,
    version: number | undefined,
    element: Element
  ) => void;
  readonly metrics: DiffMetrics;
  readonly driftCommentLabels?: PierDriftCommentLabels;
  readonly onGutterReviewActivate?: (event: PierGutterReviewEvent) => void;
  readonly onHunkAction?: (event: PierHunkActionEvent) => void;
  readonly overflow: "wrap" | "scroll";
  /** itemId → 该文件 diff 行内评论线程（host 投影后注入）；缺省无评论入口。 */
  readonly reviewCommentsById?: ReadonlyMap<
    string,
    readonly PierDiffReviewCommentThread[]
  >;
  readonly scheduleRenderWindowReport: () => void;
  /** 行内评论写操作回调（host 提供）；缺省无行内卡写操作。 */
  readonly inlineReviewHandlers?: PierInlineReviewHandlers;
  /** 行内评论卡 i18n 文案（host 注入）。 */
  readonly inlineReviewLabels?: PierInlineReviewLabels;
  /** threadId → 行内线程完整数据（卡片渲染用）。 */
  readonly inlineReviewThreadById?: ReadonlyMap<string, PierInlineReviewThread>;
  /** 行内评论卡 locale（相对时间格式化用）。 */
  readonly locale?: string;
}): {
  readonly activateGutterReview: (event: {
    readonly itemId: string;
    readonly lineNumber: number;
    readonly side: "additions" | "deletions";
  }) => void;
  readonly options: CodeViewOptions<PierDiffAnnotationMetadata>;
  readonly renderAnnotation: (
    annotation: { readonly metadata?: PierDiffAnnotationMetadata },
    item: { readonly id: string }
  ) => ReactNode;
  readonly style: DiffTypographyStyle;
} {
  const {
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
    driftCommentLabels,
    onGutterReviewActivate,
    onHunkAction,
    overflow,
    reviewCommentsById,
    scheduleRenderWindowReport,
    inlineReviewHandlers,
    inlineReviewLabels,
    inlineReviewThreadById,
    locale,
  } = options;
  const estimateHeightOptionsRef = useRef({
    isCollapseAllIntent: () => collapseAllIntentRef.current === true,
    isUserCollapsed,
    metrics,
  });
  estimateHeightOptionsRef.current = {
    isCollapseAllIntent: () => collapseAllIntentRef.current === true,
    isUserCollapsed,
    metrics,
  };
  // Patched `@pierre/diffs`: formatUnmodifiedLines / expandAllUnmodifiedLabel
  // (patches/@pierre__diffs@1.2.12.patch). Locale switch changes function
  // identity → hasItemLayoutOptionChanged → separator re-render.
  const formatUnmodifiedLines = useMemo(
    () =>
      createFormatUnmodifiedLines({
        unmodifiedLine: labels.unmodifiedLine,
        unmodifiedLines: labels.unmodifiedLines,
      }),
    [labels.unmodifiedLine, labels.unmodifiedLines]
  );
  const expandAllUnmodifiedLabel = labels.expandAllUnmodified;
  // gutter 评论入口：只开原生 + 按钮 UI（enableGutterUtility）。
  // 不挂 Pierre utility click 回调（会走 gutterSelecting，pointerdown 即写
  // data-selected-line，点 + 出蓝选）。激活改由 use-content-selection capture
  // 拦截 utility 路径后调 activateGutterReview。
  const activateGutterReview = useCallback(
    (event: {
      readonly itemId: string;
      readonly lineNumber: number;
      readonly side: "additions" | "deletions";
    }) => {
      if (onGutterReviewActivate === undefined) {
        return;
      }
      const thread = gutterReviewThreadForLine(
        reviewCommentsById?.get(event.itemId),
        event.side,
        event.lineNumber
      );
      onGutterReviewActivate({
        itemId: event.itemId,
        lineNumber: event.lineNumber,
        side: event.side,
        ...(thread === undefined ? {} : { threadId: thread.threadId }),
      });
      // 防御：若他处写过行选，评论打开后清掉，避免蓝选压在草稿上。
      codeViewRef.current?.clearSelectedLines();
    },
    [codeViewRef, onGutterReviewActivate, reviewCommentsById]
  );
  const codeViewOptions = useMemo<CodeViewOptions<PierDiffAnnotationMetadata>>(
    () => ({
      diffIndicators: "bars",
      diffStyle,
      disableBackground: false,
      disableLineNumbers: false,
      // 只显示默认 +；点击激活见 activateGutterReview（不经 Pierre utility click 选区）。
      enableGutterUtility: onGutterReviewActivate !== undefined,
      enableLineSelection: true,
      ...(expandAllUnmodifiedLabel === undefined
        ? {}
        : { expandAllUnmodifiedLabel }),
      formatUnmodifiedLines,
      itemMetrics: {
        diffHeaderHeight: metrics.headerHeight,
        lineHeight: metrics.lineHeight,
      },
      layout: {
        gap: metrics.gap,
        paddingBottom: 0,
        paddingTop: 0,
      },
      // 与 Worker 单源：PIER_DIFF_LINE_DIFF_TYPE（render-profile.ts）
      lineDiffType: PIER_DIFF_LINE_DIFF_TYPE,
      lineHoverHighlight: "number",
      onPostRender(element, _instance, phase, context) {
        const itemId = context.item.id;
        const viewer = codeViewRef.current?.getInstance();
        if (viewer) {
          installDiffVirtualHeightReconciler(viewer, estimateHeightOptionsRef);
        }
        if (phase === "unmount") {
          fileHoverCleanupsRef.current.get(itemId)?.();
          fileHoverCleanupsRef.current.delete(itemId);
          fileHoverHostsRef.current.delete(itemId);
          syncEstimateSkeleton(element, false);
          syncPathTitleChrome(element, true);
        } else {
          markRendered(itemId, context.version, element);
          // 每帧重标 host：Pierre 可能复用 element 但清掉 attribute；
          // light-DOM CSS 依赖 data-pier-file-host 才能 hover 显示 hunk pills。
          element.setAttribute("data-pier-file-host", itemId);
          if (context.item.type === "diff") {
            element.setAttribute(
              "data-pier-file-path",
              context.item.fileDiff.name
            );
          }
          const cacheKey =
            context.item.type === "diff"
              ? context.item.fileDiff.cacheKey
              : undefined;
          const isEstimate =
            typeof cacheKey === "string" && cacheKey.startsWith("estimate:");
          if (isEstimate) {
            element.setAttribute(PIER_DIFF_ESTIMATE_ATTR, "true");
          } else {
            element.removeAttribute(PIER_DIFF_ESTIMATE_ATTR);
          }
          // 真实 shadow 节点骨架（padding 可靠）；勿用 :host::after 画条。
          // 骨架是正文的一部分，用户收起时不得继续闪——它挂在 shadowRoot 上，
          // 是 Pierre 折叠区的兄弟节点，折叠藏不住它。
          const showSkeleton = isEstimate && !isUserCollapsed(itemId);
          const estimatedContentLines =
            isEstimate && context.item.type === "diff"
              ? estimatedContentLinesOf(context.item.fileDiff)
              : undefined;
          const reservedBodyHeightPx = showSkeleton
            ? slotVirtualHeight({
                collapsed: false,
                ...(typeof estimatedContentLines === "number"
                  ? { contentLines: estimatedContentLines }
                  : {}),
                kind: "estimate",
                metrics,
              }) - metrics.headerHeight
            : undefined;
          syncEstimateSkeleton(element, showSkeleton, reservedBodyHeightPx);
          // 路径 mono + hover 下划线（shadow 内 DOM，不依赖可能过期的 unsafeCSS）
          syncPathTitleChrome(element);
          if (fileHoverHostsRef.current.get(itemId) !== element) {
            fileHoverCleanupsRef.current.get(itemId)?.();
            const handlePointerOver = () => {
              element.setAttribute("data-pier-pointer-within", "");
            };
            const handlePointerLeave = () => {
              element.removeAttribute("data-pier-pointer-within");
            };
            element.addEventListener("pointerover", handlePointerOver);
            element.addEventListener("pointerleave", handlePointerLeave);
            fileHoverHostsRef.current.set(itemId, element);
            fileHoverCleanupsRef.current.set(itemId, () => {
              element.removeEventListener("pointerover", handlePointerOver);
              element.removeEventListener("pointerleave", handlePointerLeave);
              element.removeAttribute("data-pier-file-host");
              element.removeAttribute("data-pier-file-path");
              element.removeAttribute(PIER_DIFF_ESTIMATE_ATTR);
              element.removeAttribute("data-pier-pointer-within");
              syncEstimateSkeleton(element, false);
              syncPathTitleChrome(element, true);
            });
          }
        }
        // 虚拟化热路径：只 patch 一次，禁止每项 postRender 写 sticky style（滚动卡顿）
        stabilizeCodeViewStickyPositioning(codeViewRef.current?.getInstance(), {
          reapply: false,
        });
        scheduleRenderWindowReport();
      },
      overflow,
      preferredHighlighter: "shiki-wasm",
      smoothScrollSettings: PIER_DIFF_VIEW_SMOOTH_SCROLL_SETTINGS,
      stickyHeaders: true,
      // Dual pair + themeType: light/dark only flips CSS vars (no re-tokenize).
      theme: appearance.codeThemes,
      themeType: appearance.colorMode,
      tokenizeMaxLength: PIER_DIFF_VIEW_TOKENIZE_MAX_LINES,
      // 路径 hover/mono 权威在 path-title-chrome postRender；unsafeCSS 只承载其它壳样式。
      // 常量不放 deps（lint：外层常量变更不触发 re-render）；dev 改 appearance 需硬重启。
      unsafeCSS: CODE_VIEW_CUSTOM_CSS,
    }),
    [
      appearance.codeThemes,
      appearance.colorMode,
      codeViewRef,
      diffStyle,
      expandAllUnmodifiedLabel,
      fileHoverCleanupsRef,
      fileHoverHostsRef,
      formatUnmodifiedLines,
      isUserCollapsed,
      markRendered,
      metrics,
      onGutterReviewActivate,
      overflow,
      scheduleRenderWindowReport,
    ]
  );

  const hunkActionLabels = useMemo<PierHunkActionLabels>(
    () => ({
      revertHunk: labels.revertHunk ?? "Revert",
      stageRemainingHunk:
        labels.stageRemainingHunk ?? labels.stageHunk ?? labels.stageChanges,
      stageHunk: labels.stageHunk ?? labels.stageChanges,
      unstageHunk: labels.unstageHunk ?? labels.unstageChanges,
    }),
    [labels]
  );

  const renderAnnotation = useCallback(
    (
      annotation: {
        readonly metadata?: PierDiffAnnotationMetadata;
      },
      item: { readonly id: string }
    ): ReactNode => {
      const metadata = annotation.metadata;
      const reviewNode = renderReviewAnnotation(metadata, {
        driftCommentLabels,
        handlers: inlineReviewHandlers,
        labels: inlineReviewLabels,
        locale,
        threadById: inlineReviewThreadById,
      });
      if (reviewNode !== undefined) {
        return reviewNode;
      }
      if (!onHunkAction) {
        return null;
      }
      return createElement(LiveHunkAnnotation, {
        annotation,
        inputStore,
        itemId: item.id,
        labels: hunkActionLabels,
        onHunkAction,
      });
    },
    [
      driftCommentLabels,
      hunkActionLabels,
      inlineReviewHandlers,
      inlineReviewLabels,
      inlineReviewThreadById,
      inputStore,
      locale,
      onHunkAction,
    ]
  );

  const style = useMemo<DiffTypographyStyle>(
    () => ({
      "--diffshub-annotation-border": "var(--border)",
      "--diffshub-diff-separator": "var(--border)",
      "--diffs-font-family": appearance.codeFontFamily,
      "--diffs-font-size": appearance.codeFontSize,
      "--diffs-line-height": "1.75",
      "--diffs-scrollbar-gutter-override":
        "var(--shell-scrollbar-width-legacy)",
      // 头部 CSS 高度与 itemMetrics.diffHeaderHeight 同源，避免折叠导航累积错位。
      "--pier-diff-header-height": `${metrics.headerHeight}px`,
      height: "100%",
    }),
    [appearance.codeFontFamily, appearance.codeFontSize, metrics.headerHeight]
  );

  return {
    activateGutterReview,
    options: codeViewOptions,
    renderAnnotation,
    style,
  };
}
