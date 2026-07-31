import type { CodeViewOptions, SmoothScrollSettings } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import {
  createElement,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useMemo,
} from "react";
import {
  CODE_VIEW_CUSTOM_CSS,
  type DiffTypographyStyle,
} from "./appearance.ts";
import type { PierDiffViewLabels } from "./collapse.tsx";
import { syncEstimateSkeleton } from "./estimate-skeleton.ts";
import {
  canRevertHunkForVariant,
  type PierHunkActionEvent,
  type PierHunkActionLabels,
  type PierHunkAnnotationMetadata,
  renderPierHunkAnnotation,
} from "./hunk-actions.tsx";
import {
  type DiffViewInputStore,
  useDiffViewChangeControl,
} from "./input-store.ts";
import { PIER_DIFF_LINE_DIFF_TYPE } from "./render-profile.ts";
import { stabilizeCodeViewStickyPositioning } from "./sticky-stabilize.ts";

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
    readonly codeTheme: string;
    readonly colorMode: "dark" | "light";
  };
  readonly codeViewRef: RefObject<CodeViewHandle<PierHunkAnnotationMetadata> | null>;
  readonly diffStyle: "split" | "unified";
  readonly fileHoverCleanupsRef: RefObject<Map<string, () => void>>;
  readonly fileHoverHostsRef: RefObject<Map<string, HTMLElement>>;
  readonly inputStore: DiffViewInputStore;
  readonly labels: PierDiffViewLabels;
  readonly markRendered: (
    itemId: string,
    version: number | undefined,
    element: Element
  ) => void;
  readonly metrics: {
    readonly diffHeaderHeight: number;
    readonly lineHeight: number;
  };
  readonly onHunkAction?: (event: PierHunkActionEvent) => void;
  readonly overflow: "wrap" | "scroll";
  readonly scheduleRenderWindowReport: () => void;
}): {
  readonly options: CodeViewOptions<PierHunkAnnotationMetadata>;
  readonly renderAnnotation: (
    annotation: { readonly metadata?: PierHunkAnnotationMetadata },
    item: { readonly id: string }
  ) => ReactNode;
  readonly style: DiffTypographyStyle;
} {
  const {
    appearance,
    codeViewRef,
    diffStyle,
    fileHoverCleanupsRef,
    fileHoverHostsRef,
    inputStore,
    labels,
    markRendered,
    metrics,
    onHunkAction,
    overflow,
    scheduleRenderWindowReport,
  } = options;
  const codeViewOptions = useMemo<CodeViewOptions<PierHunkAnnotationMetadata>>(
    () => ({
      diffIndicators: "bars",
      diffStyle,
      disableBackground: false,
      disableLineNumbers: false,
      // No review comments — keep gutter utility off (avoids empty "+").
      enableGutterUtility: false,
      enableLineSelection: true,
      itemMetrics: {
        diffHeaderHeight: metrics.diffHeaderHeight,
        lineHeight: metrics.lineHeight,
      },
      layout: { gap: 1, paddingBottom: 0, paddingTop: 0 },
      // 与 Worker 单源：PIER_DIFF_LINE_DIFF_TYPE（render-profile.ts）
      lineDiffType: PIER_DIFF_LINE_DIFF_TYPE,
      lineHoverHighlight: "number",
      onPostRender(element, _instance, phase, context) {
        const itemId = context.item.id;
        if (phase === "unmount") {
          fileHoverCleanupsRef.current.get(itemId)?.();
          fileHoverCleanupsRef.current.delete(itemId);
          fileHoverHostsRef.current.delete(itemId);
          syncEstimateSkeleton(element, false);
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
            element.setAttribute("data-pier-estimate", "true");
          } else {
            element.removeAttribute("data-pier-estimate");
          }
          // 真实 shadow 节点骨架（padding 可靠）；勿用 :host::after 画条
          syncEstimateSkeleton(element, isEstimate);
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
              element.removeAttribute("data-pier-estimate");
              element.removeAttribute("data-pier-pointer-within");
              syncEstimateSkeleton(element, false);
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
      theme: appearance.codeTheme,
      themeType: appearance.colorMode,
      tokenizeMaxLength: PIER_DIFF_VIEW_TOKENIZE_MAX_LINES,
      unsafeCSS: CODE_VIEW_CUSTOM_CSS,
    }),
    [
      appearance.codeTheme,
      appearance.colorMode,
      codeViewRef,
      diffStyle,
      fileHoverCleanupsRef,
      fileHoverHostsRef,
      markRendered,
      metrics,
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
        readonly metadata?: PierHunkAnnotationMetadata;
      },
      item: { readonly id: string }
    ): ReactNode => {
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
    [hunkActionLabels, inputStore, onHunkAction]
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
      height: "100%",
    }),
    [appearance.codeFontFamily, appearance.codeFontSize]
  );

  return {
    options: codeViewOptions,
    renderAnnotation,
    style,
  };
}

const LiveHunkAnnotation = memo(function LiveHunkAnnotation({
  annotation,
  inputStore,
  itemId,
  labels,
  onHunkAction,
}: {
  readonly annotation: {
    readonly metadata?: PierHunkAnnotationMetadata;
  };
  readonly inputStore: DiffViewInputStore;
  readonly itemId: string;
  readonly labels: PierHunkActionLabels;
  readonly onHunkAction: (event: PierHunkActionEvent) => void;
}): ReactNode {
  const metadata = annotation.metadata;
  const control = useDiffViewChangeControl(
    inputStore,
    itemId,
    metadata?.changeKey ?? ""
  );
  // annotation 是正文解析时的锚点快照；按钮能力必须来自实时控制态。
  // 当前账本已移除该 changeKey 时不继续渲染旧按钮。
  if (!(metadata && control)) {
    return null;
  }
  const disabled = control.busy === true;
  // 可见性由 CSS [data-pier-file-host]:hover 控制，此处只渲染 DOM。
  return renderPierHunkAnnotation({
    annotation: {
      metadata: {
        ...metadata,
        canRevert: control.canRevert ?? canRevertHunkForVariant(control.state),
        stageState: control.state,
      },
    },
    ...(disabled ? { disabled: true } : {}),
    itemId,
    labels,
    onHunkAction,
    ...(control.pendingAction === undefined
      ? {}
      : { pendingAction: control.pendingAction }),
    stageState: control.state,
  });
});
