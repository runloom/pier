import type {
  GitReviewFileDocumentOk,
  GitReviewFileDocumentResult,
  GitReviewFileSection,
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

function remapSectionToSlot(
  section: GitReviewFileSection,
  slot: GitReviewIndexEntry["renderSlots"][number]
): GitReviewFileSection {
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
}

/**
 * 槽位数一致时按 index 重绑 sectionKey（stage 换 group 常见）。
 * 必须整表对齐，供 fresh load 校验。
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
    return remapSectionToSlot(section, slot);
  });
  return {
    ...document,
    revision: `${document.revision}:slot-remap`,
    sections,
  };
}

/**
 * 半暂存 / stage 导致 1↔2 槽时，尽量保住旧正文，避免整文件掉成 estimate。
 *
 * 策略：
 * 1. 同 sectionKey 精确命中 → 原样保留
 * 2. 剩余槽按剩余 section 顺序软绑（stale bridge，真 load 到达后 cacheKey 换新）
 * 3. 仍无 body 的槽不写进 document（投影侧走 estimate，只影响新增半槽）
 *
 * 仅用于跨代 retain，不用于 fresh document 验收。
 */
export function softRemapDocumentSectionsToEntry(
  entry: GitReviewIndexEntry,
  document: GitReviewFileDocumentOk
): GitReviewFileDocumentOk | null {
  if (entry.renderSlots.length === 0 || document.sections.length === 0) {
    return null;
  }
  const strict = remapDocumentSectionsToEntry(entry, document);
  if (strict) {
    return strict;
  }

  const usedSectionIndexes = new Set<number>();
  const bySlotKey = new Map<string, GitReviewFileSection>();

  for (const slot of entry.renderSlots) {
    const exactIndex = document.sections.findIndex(
      (section, index) =>
        !usedSectionIndexes.has(index) && section.sectionKey === slot.sectionKey
    );
    if (exactIndex < 0) {
      continue;
    }
    usedSectionIndexes.add(exactIndex);
    const section = document.sections[exactIndex];
    if (section) {
      bySlotKey.set(slot.sectionKey, section);
    }
  }

  // 自由槽填充：优先 unstaged（半暂存残体常在操作侧），再 staged。
  // 禁止默认扫 renderSlots 序把唯一旧 body 钉到 staged 第一槽（R2）。
  const freeSlots = entry.renderSlots.filter(
    (slot) => !bySlotKey.has(slot.sectionKey)
  );
  const orderedFreeSlots = [
    ...freeSlots.filter((slot) => slot.group === "unstaged"),
    ...freeSlots.filter((slot) => slot.group === "staged"),
    ...freeSlots.filter(
      (slot) => slot.group !== "unstaged" && slot.group !== "staged"
    ),
  ];
  for (const slot of orderedFreeSlots) {
    const freeIndex = document.sections.findIndex(
      (_section, index) => !usedSectionIndexes.has(index)
    );
    if (freeIndex < 0) {
      break;
    }
    usedSectionIndexes.add(freeIndex);
    const previous = document.sections[freeIndex];
    if (!previous) {
      continue;
    }
    bySlotKey.set(slot.sectionKey, remapSectionToSlot(previous, slot));
  }

  const sections = entry.renderSlots.flatMap((slot) => {
    const section = bySlotKey.get(slot.sectionKey);
    return section ? [section] : [];
  });
  if (sections.length === 0) {
    return null;
  }
  return {
    ...document,
    revision: `${document.revision}:slot-soft-remap`,
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
 * - 槽位数一致：strict remap
 * - 半暂存 1↔2：soft remap，尽量保旧 body，新增半槽可 estimate
 */
export function retainLoadedDocumentForEntry(
  entry: GitReviewIndexEntry,
  document: GitReviewFileDocumentOk
): LoadedDocumentResource | null {
  const remapped = softRemapDocumentSectionsToEntry(entry, document);
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

/**
 * settle 成功路径：ok/unchanged/error → resource。
 * fresh ok 只接受 strict remap（整表对齐），不走 soft 以免吞不完整文档。
 */
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
