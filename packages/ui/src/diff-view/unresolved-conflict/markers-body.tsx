import type { FileContents } from "@pierre/diffs";
import { UnresolvedFile } from "@pierre/diffs/react";
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../../button.tsx";
import { SCROLLBAR_SYSTEM_CSS } from "../../scrollbar-system.ts";
import { ensurePierDiffLightDomStyles } from "../appearance.ts";
import type {
  PierDiffViewAppearance,
  PierDiffViewPresentation,
} from "../types.ts";
import { createFormatUnmodifiedLines } from "../use-code-options.ts";
import { ConflictAcceptActions } from "./accept-actions.tsx";
import { FileLevelConflictCard } from "./file-level.tsx";
import { applyConflictResolution, countUnresolvedMarkers } from "./rebuild.ts";
import type {
  ConflictActionLike,
  ConflictGeometry,
  ConflictResolution,
  PierUnresolvedConflictLabels,
} from "./types.ts";

/** Minimal unsafe CSS for conflict host — no CodeView multi-file chrome. */
const CONFLICT_UNSAFE_CSS = `
${SCROLLBAR_SYSTEM_CSS}

  :host {
    color-scheme: light dark;
  }

  pre, [data-code], [data-line], [data-content] {
    -webkit-user-select: text;
    user-select: text;
  }
`;

interface UnresolvedInstanceLike {
  readonly options?: {
    readonly onMergeConflictAction?: (
      payload: {
        conflict: ConflictGeometry;
        resolution: ConflictResolution;
      },
      self: unknown
    ) => void;
  };
}

export function MarkersConflictBody(options: {
  readonly appearance: PierDiffViewAppearance;
  readonly busy: boolean;
  readonly contents: string;
  readonly contentsDigest: string;
  readonly labels: PierUnresolvedConflictLabels;
  readonly onError?: (error: Error) => void;
  readonly onOpenFile?: () => void;
  readonly onWriteResolved?: (payload: {
    readonly contents: string;
    readonly contentsDigest: string;
  }) => void | Promise<void>;
  readonly path: string;
  readonly presentation?: PierDiffViewPresentation;
}): ReactElement {
  const writingRef = useRef(false);
  const acceptLockedRef = useRef(false);
  const liveContentsRef = useRef(options.contents);
  const [acceptLocked, setAcceptLocked] = useState(false);
  const [writing, setWriting] = useState(false);
  /** Bumped on write failure so UnresolvedFile remounts from server contents. */
  const [remountEpoch, setRemountEpoch] = useState(0);

  useEffect(() => {
    ensurePierDiffLightDomStyles();
  }, []);

  useEffect(() => {
    liveContentsRef.current = options.contents;
    writingRef.current = false;
    acceptLockedRef.current = false;
    setWriting(false);
    setAcceptLocked(false);
    setRemountEpoch(0);
  }, [options.contents]);

  const file = useMemo<FileContents>(
    () => ({
      cacheKey: `${options.contentsDigest}:${remountEpoch}`,
      contents: options.contents,
      name: options.path,
    }),
    [options.contents, options.contentsDigest, options.path, remountEpoch]
  );

  const controlsDisabled = options.busy || writing || acceptLocked;

  const restoreFromServer = useCallback(() => {
    liveContentsRef.current = options.contents;
    writingRef.current = false;
    acceptLockedRef.current = false;
    setWriting(false);
    setAcceptLocked(false);
    setRemountEpoch((epoch) => epoch + 1);
  }, [options.contents]);

  const unlockAcceptAfterPaint = useCallback(() => {
    // Let Pierre re-render new region geometry before the next Accept.
    requestAnimationFrame(() => {
      acceptLockedRef.current = false;
      setAcceptLocked(false);
    });
  }, []);

  const tryWriteIfFullyResolved = useCallback(
    (nextContents: string) => {
      if (countUnresolvedMarkers(nextContents) > 0) {
        unlockAcceptAfterPaint();
        return;
      }
      if (options.onWriteResolved === undefined || writingRef.current) {
        unlockAcceptAfterPaint();
        return;
      }
      writingRef.current = true;
      setWriting(true);
      Promise.resolve(
        options.onWriteResolved({
          contents: nextContents,
          contentsDigest: options.contentsDigest,
        })
      )
        .then(() => {
          unlockAcceptAfterPaint();
        })
        .catch((error: unknown) => {
          restoreFromServer();
          options.onError?.(
            error instanceof Error ? error : new Error(String(error))
          );
        })
        .finally(() => {
          writingRef.current = false;
          setWriting(false);
        });
    },
    [options, restoreFromServer, unlockAcceptAfterPaint]
  );

  const renderMergeConflictUtility = useCallback(
    (action: ConflictActionLike, getInstance: () => unknown): ReactNode => {
      const run = (resolution: ConflictResolution) => {
        if (options.busy || writingRef.current || acceptLockedRef.current) {
          return;
        }
        const instance = getInstance() as
          | UnresolvedInstanceLike
          | null
          | undefined;
        if (instance == null) {
          return;
        }

        acceptLockedRef.current = true;
        setAcceptLocked(true);

        // Host tracks text with the same geometry as Pierre's injected action.
        // Only call onMergeConflictAction (not resolveConflict) — React applies once.
        const next = applyConflictResolution(
          liveContentsRef.current,
          action.conflict,
          resolution
        );
        liveContentsRef.current = next;
        instance.options?.onMergeConflictAction?.(
          { conflict: action.conflict, resolution },
          instance
        );
        tryWriteIfFullyResolved(next);
      };

      return (
        <ConflictAcceptActions
          disabled={controlsDisabled}
          labels={options.labels}
          onAccept={run}
        />
      );
    },
    [controlsDisabled, options.busy, options.labels, tryWriteIfFullyResolved]
  );

  const formatUnmodifiedLines = useMemo(
    () =>
      createFormatUnmodifiedLines({
        unmodifiedLine: options.labels.unmodifiedLine,
        unmodifiedLines: options.labels.unmodifiedLines,
      }),
    [options.labels.unmodifiedLine, options.labels.unmodifiedLines]
  );

  const pierreOptions = useMemo(
    () => ({
      enableLineSelection: true,
      ...(options.labels.expandAllUnmodified === undefined
        ? {}
        : { expandAllUnmodifiedLabel: options.labels.expandAllUnmodified }),
      formatUnmodifiedLines,
      maxContextLines: 20,
      mergeConflictActionsType: "none" as const,
      overflow:
        options.presentation?.wrapLines === true
          ? ("wrap" as const)
          : ("scroll" as const),
      theme: options.appearance.codeThemes,
      themeType: options.appearance.colorMode,
      unsafeCSS: CONFLICT_UNSAFE_CSS,
    }),
    [
      formatUnmodifiedLines,
      options.appearance.codeThemes,
      options.appearance.colorMode,
      options.labels.expandAllUnmodified,
      options.presentation?.wrapLines,
    ]
  );

  const renderHeaderMetadata = useCallback(() => {
    if (options.onOpenFile === undefined && !controlsDisabled) {
      return null;
    }
    return (
      <span className="inline-flex items-center gap-2">
        {controlsDisabled ? (
          <span className="text-muted-foreground text-xs">
            {options.labels.resolving}
          </span>
        ) : null}
        {options.onOpenFile ? (
          <Button
            disabled={controlsDisabled}
            onClick={options.onOpenFile}
            size="xs"
            type="button"
            variant="ghost"
          >
            {options.labels.openFile}
          </Button>
        ) : null}
      </span>
    );
  }, [
    controlsDisabled,
    options.labels.openFile,
    options.labels.resolving,
    options.onOpenFile,
  ]);

  // CSS content tokens need quotes; JSON.stringify is a valid CSS string.
  const style = useMemo(
    (): CSSProperties => ({
      ["--diffs-conflict-current-label" as string]: JSON.stringify(
        options.labels.currentChange
      ),
      ["--diffs-conflict-incoming-label" as string]: JSON.stringify(
        options.labels.incomingChange
      ),
      ["--diffs-font-family" as string]: options.appearance.codeFontFamily,
      ["--diffs-font-size" as string]: options.appearance.codeFontSize,
      colorScheme: options.appearance.colorMode,
      height: "100%",
      minHeight: 0,
      width: "100%",
    }),
    [
      options.appearance.codeFontFamily,
      options.appearance.codeFontSize,
      options.appearance.colorMode,
      options.labels.currentChange,
      options.labels.incomingChange,
    ]
  );

  if (countUnresolvedMarkers(options.contents) === 0) {
    return (
      <FileLevelConflictCard
        busy={options.busy}
        labels={options.labels}
        path={options.path}
        {...(options.onOpenFile === undefined
          ? {}
          : { onOpenFile: options.onOpenFile })}
      />
    );
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col"
      data-pier-unresolved-conflict=""
      data-pier-unresolved-path={options.path}
      style={{ colorScheme: options.appearance.colorMode }}
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <UnresolvedFile
          disableWorkerPool={false}
          file={file}
          key={file.cacheKey}
          options={pierreOptions}
          renderHeaderMetadata={renderHeaderMetadata}
          renderMergeConflictUtility={renderMergeConflictUtility}
          style={style}
        />
      </div>
    </div>
  );
}
