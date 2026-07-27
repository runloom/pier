import type { CodeViewOptions } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { type ReactNode, type RefObject, useCallback, useMemo } from "react";
import {
  CODE_VIEW_CUSTOM_CSS,
  type DiffTypographyStyle,
} from "./diff-view-appearance.ts";
import type { PierDiffViewLabels } from "./diff-view-collapse.tsx";
import {
  type PierHunkActionEvent,
  type PierHunkActionLabels,
  type PierHunkAnnotationMetadata,
  renderPierHunkAnnotation,
} from "./diff-view-hunk-actions.tsx";
import type { PierDiffViewItem } from "./diff-view-items.ts";
import { stabilizeCodeViewStickyPositioning } from "./diff-view-sticky-stabilize.ts";

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
  readonly inputs: readonly PierDiffViewItem[];
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
    inputs,
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
      lineHoverHighlight: "number",
      onPostRender(element, _instance, phase, context) {
        const itemId = context.item.id;
        if (phase === "unmount") {
          fileHoverCleanupsRef.current.get(itemId)?.();
          fileHoverCleanupsRef.current.delete(itemId);
          fileHoverHostsRef.current.delete(itemId);
        } else {
          markRendered(itemId, context.version, element);
          // 每帧重标 host：Pierre 可能复用 element 但清掉 attribute；
          // light-DOM CSS 依赖 data-pier-file-host 才能 hover 显示 hunk pills。
          element.setAttribute("data-pier-file-host", itemId);
          const cacheKey =
            context.item.type === "diff"
              ? context.item.fileDiff.cacheKey
              : undefined;
          if (
            typeof cacheKey === "string" &&
            cacheKey.startsWith("estimate:")
          ) {
            element.setAttribute("data-pier-estimate", "true");
          } else {
            element.removeAttribute("data-pier-estimate");
          }
          if (fileHoverHostsRef.current.get(itemId) !== element) {
            fileHoverCleanupsRef.current.get(itemId)?.();
            fileHoverHostsRef.current.set(itemId, element);
            fileHoverCleanupsRef.current.set(itemId, () => {
              element.removeAttribute("data-pier-file-host");
              element.removeAttribute("data-pier-estimate");
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
      stickyHeaders: true,
      theme: appearance.codeTheme,
      themeType: appearance.colorMode,
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
      // Busy state is live on PierDiffViewItem.stageControl (not in annotation
      // metadata cacheKey); resolve from current inputs.
      const input = inputs.find((candidate) => candidate.id === item.id);
      const disabled = input?.stageControl?.busy === true;
      // 可见性由 CSS [data-pier-file-host]:hover 控制，此处只渲染 DOM。
      return renderPierHunkAnnotation({
        annotation,
        ...(disabled ? { disabled: true } : {}),
        itemId: item.id,
        labels: hunkActionLabels,
        onHunkAction,
      });
    },
    [hunkActionLabels, inputs, onHunkAction]
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
