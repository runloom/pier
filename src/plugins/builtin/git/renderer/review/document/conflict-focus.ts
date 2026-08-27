import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";

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

export function focusConflictItems(
  items: readonly PierDiffViewItem[],
  selectedSectionKey: string | null
): readonly PierDiffViewItem[] {
  const conflictItems = items.filter(isConflictSurfaceItem);
  const fallback = conflictItems[0];
  if (fallback === undefined) {
    return [];
  }
  const focused =
    selectedSectionKey === null
      ? undefined
      : conflictItems.find((item) => item.id === selectedSectionKey);
  return [focused ?? fallback];
}
