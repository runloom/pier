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
import { ensurePierDiffLightDomStyles } from "../appearance.ts";
import { diffMetrics } from "../geometry.ts";
import type {
  PierDiffViewAppearance,
  PierDiffViewPresentation,
} from "../types.ts";
import { ConflictAcceptActions } from "./accept-actions.tsx";
import { createFormatUnmodifiedLines } from "./format-unmodified-lines.ts";
import { CONFLICT_HOST_UNSAFE_CSS } from "./host-css.ts";
import { applyConflictResolution, countUnresolvedMarkers } from "./rebuild.ts";
import type {
  ConflictActionLike,
  ConflictGeometry,
  ConflictResolution,
  PierUnresolvedConflictLabels,
} from "./types.ts";

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
  readonly onWriteResolved?: (payload: {
    readonly contents: string;
    readonly contentsDigest: string;
  }) => void | Promise<void>;
  readonly path: string;
  readonly presentation?: PierDiffViewPresentation;
}): ReactElement {
  const metrics = diffMetrics(options.appearance.codeFontSize);
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
      disableFileHeader: true,
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
      unsafeCSS: CONFLICT_HOST_UNSAFE_CSS,
    }),
    [
      formatUnmodifiedLines,
      options.appearance.codeThemes,
      options.appearance.colorMode,
      options.labels.expandAllUnmodified,
      options.presentation?.wrapLines,
    ]
  );

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
      options.labels.currentChange,
      options.labels.incomingChange,
    ]
  );

  return (
    <div
      className="min-w-0 overflow-hidden"
      data-pier-unresolved-conflict=""
      data-pier-unresolved-path={options.path}
      style={{ colorScheme: options.appearance.colorMode }}
    >
      <UnresolvedFile
        disableWorkerPool={false}
        file={file}
        key={file.cacheKey}
        options={pierreOptions}
        renderMergeConflictUtility={renderMergeConflictUtility}
        style={style}
      />
    </div>
  );
}
