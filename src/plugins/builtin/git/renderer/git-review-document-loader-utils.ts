import type {
  GitReviewFileDocumentOk,
  GitReviewFileDocumentResult,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";
import type { GitReviewDocumentResource } from "./git-review-document-resource.ts";

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

type LoadedDocumentResource = Extract<
  GitReviewDocumentResource,
  { kind: "loaded" }
>;

/** 从 session 缓存挑选可灌入 loader 的 loaded 正文（slots 必须匹配）。 */
export function collectHydrateCandidates(
  resources: ReadonlyMap<string, GitReviewDocumentResource>,
  loaded: ReadonlyMap<string, LoadedDocumentResource>
): readonly {
  readonly document: GitReviewFileDocumentOk;
  readonly entry: GitReviewIndexEntry;
  readonly entryKey: string;
}[] {
  const candidates: {
    readonly document: GitReviewFileDocumentOk;
    readonly entry: GitReviewIndexEntry;
    readonly entryKey: string;
  }[] = [];
  for (const [entryKey, resource] of loaded) {
    const current = resources.get(entryKey);
    if (!current) {
      continue;
    }
    if (!documentMatchesSlots(current.entry, resource.document)) {
      continue;
    }
    candidates.push({
      document: resource.document,
      entry: current.entry,
      entryKey,
    });
  }
  return candidates;
}

/** settle 成功路径：ok/unchanged/error → resource；slots 匹配的 ok 走 retain。 */
export function resourceFromDocumentResult(
  entry: GitReviewIndexEntry,
  result: GitReviewFileDocumentResult
):
  | { readonly document: GitReviewFileDocumentOk; readonly kind: "retain" }
  | Exclude<
      GitReviewDocumentResource,
      { kind: "loaded" | "idle" | "loading" | "cancelling" }
    > {
  if (result.kind === "ok" && documentMatchesSlots(entry, result)) {
    return { document: result, kind: "retain" };
  }
  if (result.kind === "ok") {
    return {
      entry,
      failure: {
        kind: "error",
        message: "Git Review document sections do not match the index slots.",
        reason: "internal",
        retryable: true,
      },
      kind: "error",
    };
  }
  if (result.kind === "unchanged") {
    return { entry, kind: "unchanged" };
  }
  return { entry, failure: result, kind: "error" };
}
