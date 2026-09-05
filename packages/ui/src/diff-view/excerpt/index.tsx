import type { CodeViewOptions, FileDiffMetadata } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { SCROLLBAR_SYSTEM_CSS } from "../../scrollbar-system.ts";
import { hardenCodeViewInstanceChanged } from "../code-view-runtime.ts";
import { diffMetrics } from "../geometry.ts";
import { PIER_DIFF_LINE_DIFF_TYPE } from "../render-profile.ts";
import type { PierDiffViewAppearance } from "../types.ts";
import { PierDiffWorkerProvider } from "../worker.tsx";
import { EXCERPT_LAYOUT, useExcerptHeight } from "./use-height.ts";

/** A single exact partial hunk: no review controls, file shell or git state. */
export function PierDiffExcerpt({
  fileDiff,
  appearance,
  maxHeight,
  onError,
}: {
  fileDiff: FileDiffMetadata;
  appearance: PierDiffViewAppearance;
  maxHeight: number;
  onError: (error: Error) => void;
}) {
  const ref = useRef<CodeViewHandle<undefined>>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const metrics = diffMetrics(appearance.codeFontSize);
  const measureHeight = useExcerptHeight(
    ref,
    rootRef,
    maxHeight,
    `${fileDiff.cacheKey}:${appearance.codeFontFamily}:${appearance.codeFontSize}`
  );
  const options = useMemo<CodeViewOptions<undefined>>(
    () => ({
      diffStyle: "unified",
      diffIndicators: "classic",
      overflow: "wrap",
      disableFileHeader: true,
      stickyHeaders: false,
      enableLineSelection: false,
      hunkSeparators: "line-info-basic",
      lineDiffType: PIER_DIFF_LINE_DIFF_TYPE,
      theme: appearance.codeThemes,
      themeType: appearance.colorMode,
      preferredHighlighter: "shiki-wasm",
      layout: EXCERPT_LAYOUT,
      itemMetrics: {
        lineHeight: metrics.lineHeight,
        paddingTop: 0,
        paddingBottom: 0,
      },
      // Body padding matches itemMetrics; outer CodeView owns scrolling and insets.
      unsafeCSS: `${SCROLLBAR_SYSTEM_CSS}\n[data-code]{padding-block:0;scrollbar-gutter:auto} pre,[data-code],[data-line],[data-content]{user-select:text;-webkit-user-select:text} *::selection{background:var(--editor-selection-bg);color:inherit}`,
      onPostRender: () => {
        hardenCodeViewInstanceChanged(ref.current?.getInstance());
        measureHeight();
      },
    }),
    [
      appearance.codeThemes,
      appearance.colorMode,
      metrics.lineHeight,
      measureHeight,
    ]
  );
  const items = useMemo(
    () => [
      {
        type: "diff" as const,
        id: fileDiff.cacheKey ?? fileDiff.name,
        fileDiff,
      },
    ],
    [fileDiff]
  );
  useEffect(() => {
    hardenCodeViewInstanceChanged(ref.current?.getInstance());
  }, []);
  const style = {
    maxHeight,
    "--diffs-font-family": appearance.codeFontFamily,
    "--diffs-font-size": appearance.codeFontSize,
    "--diffs-line-height": `${metrics.lineHeight}px`,
  } as CSSProperties;
  return (
    <PierDiffWorkerProvider
      onError={onError}
      onUnavailable={() => onError(new Error("highlight-unavailable"))}
      theme={appearance.codeThemes}
    >
      <div data-slot="pier-diff-excerpt" ref={rootRef} style={style}>
        <CodeView
          className="min-h-0 overflow-auto overscroll-contain"
          data-scrollbar="overlay"
          items={items}
          options={options}
          ref={ref}
          style={{ height: "100%" }}
        />
      </div>
    </PierDiffWorkerProvider>
  );
}
