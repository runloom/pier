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
 * Merge-changes shows one selected conflict, not a CodeView list.
 * Ordinary diffs keep every code item. A conflict-only ledger never falls
 * through to CodeView.
 */
export function resolveReviewDocumentBody(
  items: readonly PierDiffViewItem[],
  surface: GitReviewReadingSurface,
  selectedSectionKey?: string | null
): {
  readonly conflictItem: PierDiffViewItem | null;
  readonly items: readonly PierDiffViewItem[];
} {
  const conflictItems = items.filter(isConflictSurfaceItem);
  const codeItems = items.filter((item) => !isConflictSurfaceItem(item));
  if (surface === "conflict" && conflictItems.length > 0) {
    const selected =
      conflictItems.find((item) => item.id === selectedSectionKey) ??
      conflictItems[0] ??
      null;
    return { conflictItem: selected, items: [] };
  }
  if (isConflictOnlyBody(conflictItems.length, codeItems.length)) {
    const selected =
      conflictItems.find((item) => item.id === selectedSectionKey) ??
      conflictItems[0] ??
      null;
    return { conflictItem: selected, items: [] };
  }
  return {
    conflictItem: null,
    items: codeItems.length > 0 ? codeItems : items,
  };
}
