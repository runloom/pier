import type {
  PierDiffViewHandle,
  PierDiffViewItem,
  PierDiffViewLineSelection,
  PierDiffViewPointerLineHit,
} from "@pier/ui/diff-view/index.tsx";

type DiffSide = "additions" | "deletions";

/**
 * Resolve path + working-tree line for “Jump to Source” from diff selection
 * and/or the pointer hit under the context menu.
 *
 * Line policy (v1):
 * - Only `additions` (new-file / working-tree) line numbers are passed to the
 *   editor. Pure `deletions` hits open the file without a line.
 * - Prefer the pointer hit when there is no selection, the selection is on
 *   another item, or the hit is outside the selected line range.
 * - Prefer the selection start only when the hit lies inside the selection
 *   (or there is no hit) and the selection is additions-only.
 */
export function resolveGitReviewDiffOpenTarget(options: {
  readonly event: Pick<MouseEvent | PointerEvent, "composedPath" | "target">;
  readonly handle: PierDiffViewHandle | null | undefined;
  readonly items: readonly PierDiffViewItem[];
}): { line?: number; path: string } | null {
  const { event, handle, items } = options;
  if (!handle) {
    return null;
  }

  const hit = handle.resolvePointerLineHit(event);
  const selection = handle.getSelectedLines();
  // Prefer the item under the pointer so cross-file selection does not steal path.
  const itemId = hit?.id ?? selection?.id;
  if (!itemId) {
    return null;
  }

  const item = items.find((entry) => entry.id === itemId);
  const path = item?.fileDisplay?.path;
  if (!path) {
    return null;
  }

  const line = resolveWorkingTreeLine({ hit, itemId, selection });
  return line === undefined ? { path } : { line, path };
}

function resolveWorkingTreeLine(options: {
  readonly hit: PierDiffViewPointerLineHit | null;
  readonly itemId: string;
  readonly selection: PierDiffViewLineSelection | null;
}): number | undefined {
  const { hit, itemId, selection } = options;
  const sameItemSelection =
    selection && selection.id === itemId ? selection : null;

  if (hit && hit.id === itemId) {
    if (sameItemSelection && selectionContainsHit(sameItemSelection, hit)) {
      return (
        workingTreeLineFromSelection(sameItemSelection) ??
        workingTreeLineFromHit(hit)
      );
    }
    return workingTreeLineFromHit(hit);
  }

  if (sameItemSelection) {
    return workingTreeLineFromSelection(sameItemSelection);
  }
  return;
}

function selectionContainsHit(
  selection: PierDiffViewLineSelection,
  hit: PierDiffViewPointerLineHit
): boolean {
  if (selection.id !== hit.id) {
    return false;
  }
  const startSide: DiffSide = selection.range.side ?? "additions";
  const endSide: DiffSide = selection.range.endSide ?? startSide;
  // Cross-side ranges do not form a continuous line span; treat as not containing.
  if (startSide !== endSide) {
    return false;
  }
  if (hit.side !== startSide) {
    return false;
  }
  const from = Math.min(selection.range.start, selection.range.end);
  const to = Math.max(selection.range.start, selection.range.end);
  return hit.lineNumber >= from && hit.lineNumber <= to;
}

function workingTreeLineFromHit(
  hit: PierDiffViewPointerLineHit
): number | undefined {
  if (hit.side !== "additions") {
    return;
  }
  return normalizeLine(hit.lineNumber);
}

function workingTreeLineFromSelection(
  selection: PierDiffViewLineSelection
): number | undefined {
  const startSide: DiffSide = selection.range.side ?? "additions";
  const endSide: DiffSide = selection.range.endSide ?? startSide;
  // Only additions-only ranges map cleanly to working-tree lines.
  if (startSide !== "additions" || endSide !== "additions") {
    return;
  }
  return normalizeLine(Math.min(selection.range.start, selection.range.end));
}

function normalizeLine(line: number): number | undefined {
  if (!(Number.isFinite(line) && line >= 1 && Math.floor(line) === line)) {
    return;
  }
  return line;
}
