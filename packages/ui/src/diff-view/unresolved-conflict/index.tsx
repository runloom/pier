/**
 * Official @pierre/diffs merge-conflict host.
 * Markers → UnresolvedFile (hunk Accept). Marker-free text → File (same chrome).
 */
import type { ReactElement } from "react";
import type {
  PierDiffViewAppearance,
  PierDiffViewPresentation,
} from "../types.ts";
import { FileConflictBody } from "./file-body.tsx";
import { MarkersConflictBody } from "./markers-body.tsx";
import { applyConflictResolution, countUnresolvedMarkers } from "./rebuild.ts";
import type {
  ConflictGeometry,
  ConflictResolution,
  PierConflictFileBody,
  PierUnresolvedConflictLabels,
} from "./types.ts";

export type {
  ConflictGeometry,
  ConflictResolution,
  PierConflictFileBody,
  PierConflictPresentation,
  PierConflictXy,
  PierUnresolvedConflictLabels,
} from "./types.ts";

export interface PierUnresolvedConflictProps {
  readonly appearance: PierDiffViewAppearance;
  readonly busy?: boolean;
  readonly conflict: PierConflictFileBody;
  /**
   * Nested in a CodeView file body. Hide Pierre's own file header so the
   * list chrome stays the CodeView header.
   */
  readonly embedInCodeView?: boolean;
  readonly labels: PierUnresolvedConflictLabels;
  readonly onError?: (error: Error) => void;
  readonly onOpenFile?: () => void;
  readonly onStageFile?: () => void;
  readonly onWriteResolved?: (payload: {
    readonly contents: string;
    readonly contentsDigest: string;
  }) => void | Promise<void>;
  readonly path: string;
  readonly presentation?: PierDiffViewPresentation;
}

export function PierUnresolvedConflictView(
  props: PierUnresolvedConflictProps
): ReactElement | null {
  const {
    appearance,
    busy = false,
    conflict,
    embedInCodeView = false,
    labels,
    onError,
    onOpenFile,
    onStageFile,
    onWriteResolved,
    path,
    presentation,
  } = props;

  if (conflict.contents === null) {
    return null;
  }

  if (conflict.presentation === "markers-text") {
    return (
      <MarkersConflictBody
        appearance={appearance}
        busy={busy}
        contents={conflict.contents}
        contentsDigest={conflict.contentsDigest}
        embedInCodeView={embedInCodeView}
        labels={labels}
        path={path}
        {...(onError === undefined ? {} : { onError })}
        {...(onOpenFile === undefined ? {} : { onOpenFile })}
        {...(onWriteResolved === undefined ? {} : { onWriteResolved })}
        {...(presentation === undefined ? {} : { presentation })}
      />
    );
  }

  if (conflict.presentation !== "file-level") {
    return null;
  }

  return (
    <FileConflictBody
      appearance={appearance}
      busy={busy}
      contents={conflict.contents}
      contentsDigest={conflict.contentsDigest}
      embedInCodeView={embedInCodeView}
      labels={labels}
      path={path}
      {...(onOpenFile === undefined ? {} : { onOpenFile })}
      {...(onStageFile === undefined ? {} : { onStageFile })}
      {...(presentation === undefined ? {} : { presentation })}
    />
  );
}

/** @internal for tests */
export function __countUnresolvedMarkersForTest(contents: string): number {
  return countUnresolvedMarkers(contents);
}

/** @internal for tests */
export function __applyConflictResolutionForTest(
  contents: string,
  conflict: ConflictGeometry,
  resolution: ConflictResolution
): string {
  return applyConflictResolution(contents, conflict, resolution);
}
