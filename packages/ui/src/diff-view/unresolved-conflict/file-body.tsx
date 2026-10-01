import type { FileContents } from "@pierre/diffs";
import { File } from "@pierre/diffs/react";
import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useMemo,
} from "react";
import { ensurePierDiffLightDomStyles } from "../appearance.ts";
import { diffMetrics } from "../geometry.ts";
import type {
  PierDiffViewAppearance,
  PierDiffViewPresentation,
} from "../types.ts";
import { CONFLICT_HOST_UNSAFE_CSS } from "./host-css.ts";

/** Marker-free worktree text; the outer CodeView owns its header and actions. */
export function FileConflictBody(options: {
  readonly appearance: PierDiffViewAppearance;
  readonly contents: string;
  readonly contentsDigest: string;
  readonly path: string;
  readonly presentation?: PierDiffViewPresentation;
}): ReactElement {
  const metrics = diffMetrics(options.appearance.codeFontSize);
  useEffect(() => {
    ensurePierDiffLightDomStyles();
  }, []);

  const file = useMemo<FileContents>(
    () => ({
      cacheKey: options.contentsDigest,
      contents: options.contents,
      name: options.path,
    }),
    [options.contents, options.contentsDigest, options.path]
  );

  const pierreOptions = useMemo(
    () => ({
      disableFileHeader: true,
      enableLineSelection: true,
      overflow:
        options.presentation?.wrapLines === true
          ? ("wrap" as const)
          : ("scroll" as const),
      theme: options.appearance.codeThemes,
      themeType: options.appearance.colorMode,
      unsafeCSS: CONFLICT_HOST_UNSAFE_CSS,
    }),
    [
      options.appearance.codeThemes,
      options.appearance.colorMode,
      options.presentation?.wrapLines,
    ]
  );

  const style = useMemo(
    (): CSSProperties => ({
      ["--diffs-font-family" as string]: options.appearance.codeFontFamily,
      ["--diffs-font-size" as string]: options.appearance.codeFontSize,
      ["--diffs-line-height" as string]: `${metrics.lineHeight}px`,
      ["--pier-diff-content-padding-bottom" as string]: "0px",
      colorScheme: options.appearance.colorMode,
      height: "auto",
      width: "100%",
    }),
    [
      options.appearance.codeFontFamily,
      options.appearance.codeFontSize,
      metrics.lineHeight,
      options.appearance.colorMode,
    ]
  );

  return (
    <div
      className="min-w-0 overflow-hidden"
      data-pier-conflict-file=""
      data-pier-unresolved-path={options.path}
      style={{ colorScheme: options.appearance.colorMode }}
    >
      <File
        disableWorkerPool={false}
        file={file}
        options={pierreOptions}
        style={style}
      />
    </div>
  );
}
