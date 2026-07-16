import type {
  GitReviewFileDocumentOk,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";

export function documentMatchesSlots(
  entry: GitReviewIndexEntry,
  document: GitReviewFileDocumentOk
): boolean {
  return (
    entry.renderSlots.length === document.sections.length &&
    entry.renderSlots.every((slot, index) => {
      const section = document.sections[index];
      if (section?.sectionKey !== slot.sectionKey) {
        return false;
      }
      return (
        section.kind !== "state" ||
        (section.oldPath === slot.oldPath &&
          section.status === slot.status &&
          section.targetPath === slot.targetPath)
      );
    })
  );
}

export function sameEntries(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((entryKey, index) => entryKey === right[index])
  );
}

export function validateReviewDocumentDemand(
  entryKeys: readonly string[],
  label: string,
  hasEntry: (entryKey: string) => boolean
): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const entryKey of entryKeys) {
    if (!hasEntry(entryKey)) {
      throw new Error(`Git Review ${label}窗口条目不存在: ${entryKey}`);
    }
    if (!seen.has(entryKey)) {
      seen.add(entryKey);
      unique.push(entryKey);
    }
  }
  return unique;
}
