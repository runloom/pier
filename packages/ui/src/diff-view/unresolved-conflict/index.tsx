/**
 * Official @pierre/diffs merge-conflict host (React UnresolvedFile).
 * Custom Accept utility owns write-back; do not dual-wire resolve callbacks.
 */
import type { ReactElement } from "react";
import type {
  PierDiffViewAppearance,
  PierDiffViewPresentation,
} from "../types.ts";
import { FileLevelConflictCard } from "./file-level.tsx";
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
  readonly labels: PierUnresolvedConflictLabels;
  readonly onError?: (error: Error) => void;
  readonly onOpenFile?: () => void;
  readonly onTakeOurs?: () => void | Promise<void>;
  readonly onTakeTheirs?: () => void | Promise<void>;
  readonly onWriteResolved?: (payload: {
    readonly contents: string;
    readonly contentsDigest: string;
  }) => void | Promise<void>;
  readonly path: string;
  readonly presentation?: PierDiffViewPresentation;
}

export function PierUnresolvedConflictView(
  props: PierUnresolvedConflictProps
): ReactElement {
  const {
    appearance,
    busy = false,
    conflict,
    labels,
    onError,
    onOpenFile,
    onTakeOurs,
    onTakeTheirs,
    onWriteResolved,
    path,
    presentation,
  } = props;

  if (conflict.presentation === "markers-text" && conflict.contents !== null) {
    return (
      <MarkersConflictBody
        appearance={appearance}
        busy={busy}
        contents={conflict.contents}
        contentsDigest={conflict.contentsDigest}
        labels={labels}
        path={path}
        {...(onError === undefined ? {} : { onError })}
        {...(onOpenFile === undefined ? {} : { onOpenFile })}
        {...(onWriteResolved === undefined ? {} : { onWriteResolved })}
        {...(presentation === undefined ? {} : { presentation })}
      />
    );
  }

  return (
    <FileLevelConflictCard
      busy={busy}
      labels={labels}
      path={path}
      {...(onOpenFile === undefined ? {} : { onOpenFile })}
      {...(onTakeOurs === undefined ? {} : { onTakeOurs })}
      {...(onTakeTheirs === undefined ? {} : { onTakeTheirs })}
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
