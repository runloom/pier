import type {
  GitReviewFileDocumentOk,
  GitReviewFileDocumentResult,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import type { GitReviewDocumentResource } from "./resource.ts";

function documentMatchesEntry(
  entry: GitReviewIndexEntry,
  document: GitReviewFileDocumentOk
): boolean {
  return document.entryKey === entry.entryKey;
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

/**
 * 规范化 demand 窗口 entryKey。
 *
 * stage/unstage 全量、watch 刷新会让条目跨阅读面移动或消失；调用方 ref 里的
 * visible/buffered 键可能短暂落后于 loader `#resources`。与 setProtectedEntryKey
 * 一样 **软丢弃** 不存在的键，禁止 throw 打爆 UI（金标准：mutation TOCTOU 非致命）。
 * 仅 filter，不做日志（避免滚动热路径噪声）。
 */
export function validateReviewDocumentDemand(
  entryKeys: readonly string[],
  _label: string,
  hasEntry: (entryKey: string) => boolean
): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const entryKey of entryKeys) {
    if (!hasEntry(entryKey)) {
      continue;
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

export function retainLoadedDocumentForEntry(
  entry: GitReviewIndexEntry,
  document: GitReviewFileDocumentOk
): LoadedDocumentResource | null {
  if (!documentMatchesEntry(entry, document)) {
    return null;
  }
  return { document, entry, kind: "loaded" };
}

export function collectHydrateCandidates(
  resources: ReadonlyMap<string, GitReviewDocumentResource>,
  loaded: ReadonlyMap<string, LoadedDocumentResource>
): readonly {
  readonly document: GitReviewFileDocumentOk;
  readonly entry: GitReviewIndexEntry;
  readonly entryKey: string;
}[] {
  const candidates: {
    document: GitReviewFileDocumentOk;
    entry: GitReviewIndexEntry;
    entryKey: string;
  }[] = [];
  for (const [entryKey, resource] of loaded) {
    const current = resources.get(entryKey);
    if (current === undefined) {
      continue;
    }
    const retained = retainLoadedDocumentForEntry(
      current.entry,
      resource.document
    );
    if (retained !== null) {
      candidates.push({
        document: retained.document,
        entry: retained.entry,
        entryKey,
      });
    }
  }
  return candidates;
}

export function acceptedReviewDocument(
  result: GitReviewFileDocumentResult,
  entry: GitReviewIndexEntry
): GitReviewFileDocumentOk | null {
  return result.kind === "ok" && documentMatchesEntry(entry, result)
    ? result
    : null;
}

export function resourceFromDocumentResult(
  entry: GitReviewIndexEntry,
  result: GitReviewFileDocumentResult
):
  | { readonly document: GitReviewFileDocumentOk; readonly kind: "retain" }
  | Exclude<
      GitReviewDocumentResource,
      { kind: "loaded" | "idle" | "loading" | "cancelling" }
    > {
  if (result.kind === "ok") {
    if (documentMatchesEntry(entry, result)) {
      return { document: result, kind: "retain" };
    }
    return {
      entry,
      failure: {
        kind: "error",
        message: "git Review document does not match the index entry.",
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
