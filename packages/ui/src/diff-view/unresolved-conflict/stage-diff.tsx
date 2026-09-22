import type { CodeViewOptions, FileDiffMetadata } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { SCROLLBAR_SYSTEM_CSS } from "../../scrollbar-system.ts";
import { hardenCodeViewInstanceChanged } from "../code-view-runtime.ts";
import { parseDiffFromFile } from "../file-diff/from-contents.ts";
import { diffMetrics } from "../geometry.ts";
import { PIER_DIFF_LINE_DIFF_TYPE } from "../render-profile.ts";
import type { PierDiffViewAppearance } from "../types.ts";
import { PierDiffWorkerProvider } from "../worker.tsx";
import type {
  PierConflictFileBody,
  PierUnresolvedConflictLabels,
} from "./types.ts";

/**
 * Missing-worktree conflicts: ours → theirs is the only body.
 * Null on a side means that stage has no blob.
 */
export function conflictStageTexts(
  conflict: Pick<
    PierConflictFileBody,
    "contents" | "oursContents" | "presentation" | "theirsContents"
  >
): { readonly ours: string; readonly theirs: string } | null {
  if (conflict.contents !== null || conflict.presentation !== "file-level") {
    return null;
  }
  if (
    conflict.oursContents === undefined ||
    conflict.theirsContents === undefined
  ) {
    return null;
  }
  if (conflict.oursContents === null && conflict.theirsContents === null) {
    return null;
  }
  return {
    ours: conflict.oursContents ?? "",
    theirs: conflict.theirsContents ?? "",
  };
}

export function PierConflictStageDiff(options: {
  readonly appearance: PierDiffViewAppearance;
  readonly diffStyle?: "split" | "unified";
  readonly labels: Pick<
    PierUnresolvedConflictLabels,
    "currentChange" | "incomingChange"
  >;
  readonly onError: (error: Error) => void;
  readonly ours: string;
  readonly path: string;
  readonly theirs: string;
}): React.JSX.Element | null {
  const { appearance, labels, onError, ours, path, theirs } = options;
  const ref = useRef<CodeViewHandle<undefined>>(null);
  const metrics = diffMetrics(appearance.codeFontSize);
  const parsed = useMemo(() => {
    try {
      return {
        fileDiff: parseDiffFromFile(
          {
            cacheKey: stageCacheKey("ours", ours),
            contents: ours,
            name: path,
          },
          {
            cacheKey: stageCacheKey("theirs", theirs),
            contents: theirs,
            name: path,
          },
          { context: 3 },
          true
        ),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }, [ours, path, theirs]);
  useEffect(() => {
    if ("error" in parsed) {
      onError(parsed.error);
    }
  }, [onError, parsed]);
  const codeOptions = useMemo<CodeViewOptions<undefined>>(
    () => ({
      diffIndicators: "bars",
      diffStyle: options.diffStyle ?? "split",
      disableFileHeader: true,
      enableLineSelection: true,
      hunkSeparators: "line-info-basic",
      lineDiffType: PIER_DIFF_LINE_DIFF_TYPE,
      overflow: "scroll",
      preferredHighlighter: "shiki-wasm",
      theme: appearance.codeThemes,
      themeType: appearance.colorMode,
      unsafeCSS: SCROLLBAR_SYSTEM_CSS,
      onPostRender: () => {
        hardenCodeViewInstanceChanged(ref.current?.getInstance());
      },
    }),
    [appearance.codeThemes, appearance.colorMode, options.diffStyle]
  );
  if ("error" in parsed) {
    return null;
  }
  const fileDiff: FileDiffMetadata = parsed.fileDiff;
  const style = {
    "--diffs-font-family": appearance.codeFontFamily,
    "--diffs-font-size": appearance.codeFontSize,
    "--diffs-line-height": `${metrics.lineHeight}px`,
    height: "100%",
  } as CSSProperties;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-git-review-conflict-stage=""
    >
      <p className="px-3 pt-2 text-muted-foreground text-xs">
        {labels.currentChange}
        <span aria-hidden="true"> → </span>
        {labels.incomingChange}
      </p>
      <PierDiffWorkerProvider
        onError={onError}
        onUnavailable={() => {
          onError(new Error("highlight-unavailable"));
        }}
        theme={appearance.codeThemes}
      >
        <div className="min-h-0 flex-1">
          <CodeView
            className="h-full min-h-0"
            data-scrollbar="overlay"
            items={[
              {
                fileDiff,
                id: fileDiff.cacheKey ?? path,
                type: "diff",
              },
            ]}
            options={codeOptions}
            ref={ref}
            style={style}
          />
        </div>
      </PierDiffWorkerProvider>
    </div>
  );
}

function stageCacheKey(side: "ours" | "theirs", contents: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < contents.length; index += 1) {
    hash = Math.imul(hash + contents.charCodeAt(index), 33);
  }
  return `conflict-stage:${side}:${contents.length}:${hash}`;
}
