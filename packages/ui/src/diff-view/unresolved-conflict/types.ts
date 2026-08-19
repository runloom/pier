export type PierConflictPresentation =
  | "markers-text"
  | "file-level"
  | "binary"
  | "tooLarge"
  | "invalidEncoding"
  | "readError";

export type PierConflictXy = "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU";

export interface PierConflictFileBody {
  readonly contents: string | null;
  readonly contentsDigest: string;
  readonly presentation: PierConflictPresentation;
  readonly stages: {
    readonly baseOid: string | null;
    readonly oursOid: string | null;
    readonly theirsOid: string | null;
  };
  readonly xy: PierConflictXy;
}

export interface PierUnresolvedConflictLabels {
  readonly acceptBoth: string;
  readonly acceptCurrent: string;
  readonly acceptIncoming: string;
  /**
   * Pseudo-label after `<<<<<<<`. CSS var `--diffs-conflict-current-label`
   * (patched `@pierre/diffs` style.js).
   */
  readonly currentChange: string;
  readonly expandAllUnmodified?: string;
  /**
   * Pseudo-label after `>>>>>>>`. CSS var `--diffs-conflict-incoming-label`.
   */
  readonly incomingChange: string;
  readonly openFile: string;
  readonly resolving: string;
  /** Collapsed unmodified context templates (`{{count}}`). */
  readonly unmodifiedLine?: string;
  readonly unmodifiedLines?: string;
}

export type ConflictResolution = "current" | "incoming" | "both";

/** Geometry for Pierre MergeConflictRegion line surgery. */
export interface ConflictGeometry {
  readonly baseMarkerLineIndex?: number;
  readonly conflictIndex: number;
  readonly endLineIndex: number;
  readonly separatorLineIndex: number;
  readonly startLineIndex: number;
}

export interface ConflictActionLike {
  readonly conflict: ConflictGeometry;
  readonly conflictIndex: number;
}
