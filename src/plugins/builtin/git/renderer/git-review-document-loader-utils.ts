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

/**
 * stage 换 group 会换 sectionKey，但 patch 正文仍可复用。
 * 槽位数一致时按 index 重绑 key，避免整段 rematerialize 闪烁。
 */
export function remapDocumentSectionsToEntry(
  entry: GitReviewIndexEntry,
  document: GitReviewFileDocumentOk
): GitReviewFileDocumentOk | null {
  if (entry.renderSlots.length !== document.sections.length) {
    return null;
  }
  if (documentMatchesSlots(entry, document)) {
    return document;
  }
  const sections = document.sections.map((section, index) => {
    const slot = entry.renderSlots[index];
    if (slot === undefined) {
      return section;
    }
    if (section.kind === "patch") {
      return {
        ...section,
        sectionKey: slot.sectionKey,
      };
    }
    return {
      ...section,
      oldPath: slot.oldPath,
      sectionKey: slot.sectionKey,
      status: slot.status,
      targetPath: slot.targetPath,
    };
  });
  return {
    ...document,
    revision: `${document.revision}:slot-remap`,
    sections,
  };
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

/**
 * 将已 loaded 正文绑到当前 index entry。
 * stage 换 group 会换 sectionKey：槽位数一致时 remap 后软保留，避免投影丢项。
 */
export function retainLoadedDocumentForEntry(
  entry: GitReviewIndexEntry,
  document: GitReviewFileDocumentOk
): LoadedDocumentResource | null {
  const remapped = remapDocumentSectionsToEntry(entry, document);
  if (!remapped) {
    return null;
  }
  return {
    document: remapped,
    entry,
    kind: "loaded",
  };
}

/** 从 session 缓存挑选可灌入 loader 的 loaded 正文（可 slot-remap）。 */
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
    const retained = retainLoadedDocumentForEntry(
      current.entry,
      resource.document
    );
    if (!retained) {
      continue;
    }
    candidates.push({
      document: retained.document,
      entry: retained.entry,
      entryKey,
    });
  }
  return candidates;
}

/** settle 成功路径：ok/unchanged/error → resource；可 remap 的 ok 走 retain。 */
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
    const remapped = remapDocumentSectionsToEntry(entry, result);
    if (remapped) {
      return { document: remapped, kind: "retain" };
    }
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
