import type { DiffLineAnnotation, FileDiffMetadata, Hunk } from "@pierre/diffs";
import type { PierHunkAnnotationMetadata } from "./diff-view-hunk-actions.tsx";
import type { PierDiffViewStageControl } from "./diff-view-items.ts";

export interface HunkAnnotationAnchor {
  readonly lineNumber: number;
  readonly side: "additions" | "deletions";
}

/**
 * Codex `Ta`: last line of a change side, skipping the "\ No newline at EOF"
 * marker line when it coincides with the range end.
 */
function codexChangeSideAnchor(options: {
  readonly side: "additions" | "deletions";
  readonly start: number;
  readonly count: number;
  readonly noEofLineNumber: number | null;
}): HunkAnnotationAnchor | null {
  if (options.count === 0) {
    return null;
  }
  let end = options.start + options.count - 1;
  if (options.noEofLineNumber != null && end === options.noEofLineNumber) {
    end -= 1;
  }
  if (end < options.start || end < 1) {
    return null;
  }
  return { lineNumber: end, side: options.side };
}

type HunkAnchorSource = Pick<
  Hunk,
  | "additionCount"
  | "additionLines"
  | "additionStart"
  | "deletionCount"
  | "deletionLines"
  | "deletionStart"
  | "hunkContent"
  | "noEOFCRAdditions"
  | "noEOFCRDeletions"
>;

/**
 * One toolbar anchor per **change block** inside a git @@ hunk.
 *
 * Codex `wa` only keeps the last change; users read each green/red island as a
 * separate "变更块" and expect a pill on each. Stage/Unstage/Revert use
 * (hunkIndex, changeBlockIndex) → extractChangeBlockPatch（仅该岛，非整 @@）。
 *
 * Per block: prefer last **addition** line, else last **deletion** (Codex `Ta`).
 * Context only advances line cursors.
 */
export function hunkChangeBlockAnchors(
  hunk: HunkAnchorSource
): HunkAnnotationAnchor[] {
  let additionLine = hunk.additionStart;
  let deletionLine = hunk.deletionStart;
  const anchors: HunkAnnotationAnchor[] = [];

  const noEofAddition =
    hunk.noEOFCRAdditions === true
      ? hunk.additionStart + hunk.additionCount - 1
      : null;
  const noEofDeletion =
    hunk.noEOFCRDeletions === true
      ? hunk.deletionStart + hunk.deletionCount - 1
      : null;

  for (const block of hunk.hunkContent) {
    if (block.type === "context") {
      additionLine += block.lines;
      deletionLine += block.lines;
      continue;
    }
    const additions = codexChangeSideAnchor({
      count: block.additions,
      noEofLineNumber: noEofAddition,
      side: "additions",
      start: additionLine,
    });
    const deletions = codexChangeSideAnchor({
      count: block.deletions,
      noEofLineNumber: noEofDeletion,
      side: "deletions",
      start: deletionLine,
    });
    additionLine += block.additions;
    deletionLine += block.deletions;
    const picked = additions ?? deletions;
    if (picked != null) {
      anchors.push(picked);
    }
  }
  if (anchors.length > 0) {
    return anchors;
  }
  // Fallback when hunkContent is empty / only no-op change blocks.
  const additionLines =
    typeof hunk.additionLines === "number" && hunk.additionLines > 0
      ? hunk.additionLines
      : 0;
  const deletionLines =
    typeof hunk.deletionLines === "number" && hunk.deletionLines > 0
      ? hunk.deletionLines
      : 0;
  if (additionLines > 0 && hunk.additionStart >= 1) {
    return [
      {
        lineNumber: hunk.additionStart + additionLines - 1,
        side: "additions",
      },
    ];
  }
  if (deletionLines > 0 && hunk.deletionStart >= 1) {
    return [
      {
        lineNumber: hunk.deletionStart + deletionLines - 1,
        side: "deletions",
      },
    ];
  }
  if (hunk.additionCount > 0 && hunk.additionStart >= 1) {
    return [
      {
        lineNumber: hunk.additionStart + hunk.additionCount - 1,
        side: "additions",
      },
    ];
  }
  if (hunk.deletionCount > 0 && hunk.deletionStart >= 1) {
    return [
      {
        lineNumber: hunk.deletionStart + hunk.deletionCount - 1,
        side: "deletions",
      },
    ];
  }
  return [];
}

/**
 * Last change-block anchor for a hunk (Codex `wa` last-wins). Prefer
 * {@link hunkChangeBlockAnchors} when placing UI pills.
 */
export function hunkAnnotationAnchor(
  hunk: HunkAnchorSource
): HunkAnnotationAnchor | null {
  const anchors = hunkChangeBlockAnchors(hunk);
  return anchors.at(-1) ?? null;
}

export function buildHunkActionAnnotations(
  fileDiff: FileDiffMetadata,
  stageControl: PierDiffViewStageControl | null | undefined
): DiffLineAnnotation<PierHunkAnnotationMetadata>[] | undefined {
  if (!stageControl || fileDiff.hunks.length === 0) {
    return;
  }
  const annotations: DiffLineAnnotation<PierHunkAnnotationMetadata>[] = [];
  // Pierre slots are named annotation-{side}-{lineNumber}; keep one pill per slot.
  const seenSlots = new Set<string>();
  for (let hunkIndex = 0; hunkIndex < fileDiff.hunks.length; hunkIndex += 1) {
    const hunk = fileDiff.hunks[hunkIndex];
    if (!hunk) {
      continue;
    }
    const anchors = hunkChangeBlockAnchors(hunk);
    for (
      let changeBlockIndex = 0;
      changeBlockIndex < anchors.length;
      changeBlockIndex += 1
    ) {
      const anchor = anchors[changeBlockIndex];
      if (!anchor) {
        continue;
      }
      const slotKey = `${anchor.side}:${anchor.lineNumber}`;
      if (seenSlots.has(slotKey)) {
        continue;
      }
      seenSlots.add(slotKey);
      annotations.push({
        lineNumber: anchor.lineNumber,
        metadata: {
          changeBlockIndex,
          hunkIndex,
          kind: "hunk-actions",
          path: fileDiff.name,
          variant: stageControl.state,
        },
        side: anchor.side,
      });
    }
  }
  return annotations.length > 0 ? annotations : undefined;
}
