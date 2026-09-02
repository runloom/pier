import type { FileContents } from "@pierre/diffs";
import { File } from "@pierre/diffs/react";
import { Plus } from "lucide-react";
import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { Button } from "../../button.tsx";
import { ensurePierDiffLightDomStyles } from "../appearance.ts";
import type {
  PierDiffViewAppearance,
  PierDiffViewPresentation,
} from "../types.ts";
import { CONFLICT_HOST_UNSAFE_CSS } from "./host-css.ts";
import type { PierUnresolvedConflictLabels } from "./types.ts";

/** Marker-free worktree text: official Pierre File chrome, not a custom header. */
export function FileConflictBody(options: {
  readonly appearance: PierDiffViewAppearance;
  readonly busy: boolean;
  readonly contents: string;
  readonly contentsDigest: string;
  readonly embedInCodeView?: boolean;
  readonly labels: PierUnresolvedConflictLabels;
  readonly onOpenFile?: () => void;
  readonly onStageFile?: () => void;
  readonly path: string;
  readonly presentation?: PierDiffViewPresentation;
}): ReactElement {
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
      ...(options.embedInCodeView === true
        ? { disableFileHeader: true as const }
        : {}),
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
      options.embedInCodeView,
      options.presentation?.wrapLines,
    ]
  );

  const renderHeaderMetadata = useCallback((): ReactElement | null => {
    if (
      options.onOpenFile === undefined &&
      options.onStageFile === undefined &&
      !options.busy
    ) {
      return null;
    }
    return (
      <span className="inline-flex items-center gap-2">
        {options.busy ? (
          <span className="text-muted-foreground text-xs">
            {options.labels.resolving}
          </span>
        ) : null}
        {options.onOpenFile ? (
          <Button
            disabled={options.busy}
            onClick={options.onOpenFile}
            size="xs"
            type="button"
            variant="ghost"
          >
            {options.labels.openFile}
          </Button>
        ) : null}
        {options.onStageFile && options.labels.stageFile ? (
          <Button
            aria-label={options.labels.stageFile}
            disabled={options.busy}
            onClick={options.onStageFile}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Plus data-icon />
          </Button>
        ) : null}
      </span>
    );
  }, [
    options.busy,
    options.labels.openFile,
    options.labels.resolving,
    options.labels.stageFile,
    options.onOpenFile,
    options.onStageFile,
  ]);

  const style = useMemo(
    (): CSSProperties => ({
      ["--diffs-font-family" as string]: options.appearance.codeFontFamily,
      ["--diffs-font-size" as string]: options.appearance.codeFontSize,
      colorScheme: options.appearance.colorMode,
      height: "auto",
      width: "100%",
    }),
    [
      options.appearance.codeFontFamily,
      options.appearance.codeFontSize,
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
        {...(options.embedInCodeView === true ? {} : { renderHeaderMetadata })}
        style={style}
      />
    </div>
  );
}
