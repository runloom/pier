import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import type { GitReviewReadingSurface } from "../reading-surface.ts";

export function isConflictSurfaceItem(item: PierDiffViewItem): boolean {
  return (
    item.kind === "conflict" ||
    (item.kind === "estimate" && item.conflict !== undefined)
  );
}

/** True when this ledger has focused conflict items and no CodeView members. */
export function isConflictOnlyBody(
  conflictFocusCount: number,
  codeItemCount: number
): boolean {
  return conflictFocusCount > 0 && codeItemCount === 0;
}

/**
 * Merge-changes stays on the same CodeView list as ordinary diffs.
 * Conflict files keep CodeView chrome; UnresolvedFile fills the body slot.
 */
export function resolveReviewDocumentBody(
  items: readonly PierDiffViewItem[],
  surface: GitReviewReadingSurface
): {
  readonly items: readonly PierDiffViewItem[];
} {
  const conflictItems = items.filter(isConflictSurfaceItem);
  const codeItems = items.filter((item) => !isConflictSurfaceItem(item));
  if (surface === "conflict" && conflictItems.length > 0) {
    return { items };
  }
  if (isConflictOnlyBody(conflictItems.length, codeItems.length)) {
    return { items: conflictItems };
  }
  return {
    items: codeItems.length > 0 ? codeItems : items,
  };
}
