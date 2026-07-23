import type {
  PierDiffViewAnchor,
  PierDiffViewItem,
} from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFileStatus,
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";
import {
  GIT_REVIEW_MAX_RETAINED_BYTES,
  GIT_REVIEW_MAX_RETAINED_LINES,
  gitReviewDocumentMetrics,
  isGitReviewDocumentReservable,
} from "./git-review-document-limits.ts";
import type {
  GitReviewDocumentLoaderSnapshot,
  GitReviewDocumentResource,
} from "./git-review-document-resource.ts";
import { stateSectionText } from "./git-review-document-state-text.ts";

/**
 * Diff / tree display order (VS Code SCM):
 * conflict → staged → unstaged → committed.
 */
const REVIEW_DIFF_GROUP_INDEX: Record<GitReviewGroup, number> = {
  conflict: 0,
  staged: 1,
  unstaged: 2,
  committed: 3,
};

/** Uncommitted stage control for multi-diff headers; null when not toggleable. */
function reviewStageControl(
  group: GitReviewGroup,
  status: GitReviewFileStatus
): {
  readonly canDiscard?: boolean;
  readonly state: "staged" | "unstaged";
} | null {
  switch (group) {
    case "staged":
      return { state: "staged" };
    case "unstaged":
      return {
        // Match tree discard rule: only modified/deleted working-tree changes.
        canDiscard: status === "modified" || status === "deleted",
        state: "unstaged",
      };
    case "conflict":
    case "committed":
      return null;
    default:
      return null;
  }
}

/**
 * UI 元状态：不持有完整 document resources。
 * 真资源只在 GitReviewDocumentGeneration / loader；locale 重投影必须读 controller.snapshot。
 */
export interface ReviewDocumentViewState {
  readonly generation: number;
  readonly retainedEntryKeys: readonly string[];
  readonly settled: boolean;
  readonly staleRetainedCount: number;
}

export const EMPTY_DOCUMENT_VIEW_STATE: ReviewDocumentViewState = {
  generation: 0,
  retainedEntryKeys: [],
  settled: false,
  staleRetainedCount: 0,
};

export interface ReviewDocumentProjection {
  readonly entryKeyBySectionId: ReadonlyMap<string, string>;
  readonly items: readonly PierDiffViewItem[];
}

export interface ReviewDocumentResourceProjection {
  readonly items: readonly PierDiffViewItem[];
}

export interface ReviewDocumentProjectionIndex {
  readonly itemCacheKeys: ReadonlyMap<string, string>;
  readonly itemIds: readonly string[];
  readonly itemIndexById: ReadonlyMap<string, number>;
}

export interface PendingReviewAnchor {
  readonly anchor: PierDiffViewAnchor;
  readonly entryKey: string | null;
  readonly generation: number;
  readonly previousItemIds: readonly string[];
  readonly restored: boolean;
}

/**
 * 金标准：index 全量轻量槽进 CodeView。
 * idle/loading/error/unchanged → placeholder 头；loaded → 正文。
 * 列表身份随 index 代稳定，点击只 scroll，正文只 sparse 更新。
 */
export function projectReviewDocuments(
  snapshot: GitReviewDocumentLoaderSnapshot,
  context: RendererPluginContext,
  locale: string
): ReviewDocumentProjection {
  const entryKeyBySectionId = new Map<string, string>();
  const decorated: {
    readonly group: GitReviewGroup;
    readonly item: PierDiffViewItem;
    readonly path: string;
    readonly sectionKey: string;
  }[] = [];
  for (const resource of snapshot.resources) {
    for (const slot of resource.entry.renderSlots) {
      entryKeyBySectionId.set(slot.sectionKey, resource.entry.entryKey);
    }
    const projected = projectReviewDocumentResource(resource, context, locale);
    for (const [index, item] of projected.items.entries()) {
      const slot = resource.entry.renderSlots[index];
      if (slot === undefined) {
        continue;
      }
      decorated.push({
        group: slot.group,
        item,
        path: resource.entry.path,
        sectionKey: slot.sectionKey,
      });
    }
  }
  decorated.sort((left, right) => {
    const groupDelta =
      REVIEW_DIFF_GROUP_INDEX[left.group] -
      REVIEW_DIFF_GROUP_INDEX[right.group];
    if (groupDelta !== 0) {
      return groupDelta;
    }
    const pathDelta = left.path.localeCompare(right.path);
    if (pathDelta !== 0) {
      return pathDelta;
    }
    return left.sectionKey.localeCompare(right.sectionKey);
  });
  return {
    entryKeyBySectionId,
    items: decorated.map((entry) => entry.item),
  };
}

/** 从全量 index entries 建 entryKey → first sectionKey，供 idle 树导航解析。 */
export function indexReviewEntrySections(
  entries: readonly GitReviewIndexEntry[]
): ReadonlyMap<string, string> {
  const firstSectionIdByEntryKey = new Map<string, string>();
  for (const entry of entries) {
    const first = entry.renderSlots[0];
    if (first === undefined || firstSectionIdByEntryKey.has(entry.entryKey)) {
      continue;
    }
    firstSectionIdByEntryKey.set(entry.entryKey, first.sectionKey);
  }
  return firstSectionIdByEntryKey;
}

export function projectReviewDocumentResource(
  resource: GitReviewDocumentResource,
  context: RendererPluginContext,
  locale: string
): ReviewDocumentResourceProjection {
  const document = resource.kind === "loaded" ? resource.document : null;
  const sectionsByKey = new Map(
    document === null
      ? []
      : document.sections.map((section) => [section.sectionKey, section])
  );
  const items = resource.entry.renderSlots.map((slot): PierDiffViewItem => {
    const section = sectionsByKey.get(slot.sectionKey);
    // Half-staged files produce two items with the same path; stageControl
    // distinguishes staged vs unstaged (no group label in the path).
    const stageControl = reviewStageControl(slot.group, slot.status);
    const fileDisplay = {
      path: slot.targetPath,
      status: slot.status,
      ...(slot.oldPath === null ? {} : { previousPath: slot.oldPath }),
    };
    if (section === undefined) {
      return {
        cacheKey: `git-review-placeholder:${slot.sectionKey}`,
        fileDisplay,
        id: slot.sectionKey,
        patch: null,
        ...(stageControl === null ? {} : { stageControl }),
      };
    }
    if (section.kind === "state") {
      // Industry multi-diff: non-text changes are header + notice only.
      const stateText = stateSectionText(context, section, locale);
      return {
        cacheKey: JSON.stringify([
          document?.revision ?? "missing",
          section.sectionKey,
          locale,
          section.targetPath,
          section.oldPath,
          section.status,
          stateText,
        ]),
        fileDisplay,
        id: section.sectionKey,
        patch: null,
        stateNotice: stateText,
        ...(stageControl === null ? {} : { stageControl }),
      };
    }
    return {
      cacheKey: `${document?.revision ?? "missing"}:${section.sectionKey}`,
      fileDisplay,
      id: section.sectionKey,
      patch: section.patch,
      ...(stageControl === null ? {} : { stageControl }),
    };
  });
  return {
    items,
  };
}

/** 仅索引当前投影 items；firstSection 导航 indexReviewEntrySections(entries)。 */
export function indexReviewDocumentProjection(
  projection: ReviewDocumentProjection
): ReviewDocumentProjectionIndex {
  const itemCacheKeys = new Map<string, string>();
  const itemIndexById = new Map<string, number>();
  const itemIds = projection.items.map((item, index) => {
    itemCacheKeys.set(item.id, item.cacheKey);
    itemIndexById.set(item.id, index);
    return item.id;
  });
  return {
    itemCacheKeys,
    itemIds,
    itemIndexById,
  };
}

export interface ReconciledReviewDocumentSnapshot {
  readonly generation: number;
  readonly snapshot: GitReviewDocumentLoaderSnapshot;
  readonly staleRetainedCount: number;
}

export function reconcileReviewDocumentSnapshot(
  current: GitReviewDocumentLoaderSnapshot,
  previousByEntryKey: Map<
    string,
    Extract<GitReviewDocumentResource, { kind: "loaded" }>
  >,
  generation: number,
  protectedEntryKey: string | null
): ReconciledReviewDocumentSnapshot {
  let staleRetainedCount = 0;
  for (const resource of current.resources) {
    if (resource.kind === "loaded") {
      previousByEntryKey.delete(resource.entry.entryKey);
    }
  }
  let retainedBytes = 0;
  let retainedLines = 0;
  for (const previous of previousByEntryKey.values()) {
    const metrics = gitReviewDocumentMetrics(previous.document);
    retainedBytes += metrics.bytes;
    retainedLines += metrics.lines;
  }
  for (const resource of current.resources) {
    if (resource.kind === "loaded") {
      const metrics = gitReviewDocumentMetrics(resource.document);
      retainedBytes += metrics.bytes;
      retainedLines += metrics.lines;
    }
  }
  const protectedPreviousEntryKey = effectiveProtectedPreviousEntryKey(
    previousByEntryKey,
    protectedEntryKey
  );
  while (
    retainedBytes > GIT_REVIEW_MAX_RETAINED_BYTES ||
    retainedLines > GIT_REVIEW_MAX_RETAINED_LINES
  ) {
    const oldest = oldestUnprotectedPrevious(
      previousByEntryKey,
      protectedPreviousEntryKey
    );
    if (!oldest) {
      break;
    }
    previousByEntryKey.delete(oldest[0]);
    const metrics = gitReviewDocumentMetrics(oldest[1].document);
    retainedBytes -= metrics.bytes;
    retainedLines -= metrics.lines;
  }
  const resources = current.resources.map((resource) => {
    const previous = previousByEntryKey.get(resource.entry.entryKey);
    if (!previous) {
      return resource;
    }
    if (resource.kind === "unchanged") {
      staleRetainedCount += 1;
    } else if (resource.kind === "loaded") {
      return resource;
    }
    return {
      document: previous.document,
      entry: resource.entry,
      kind: "loaded" as const,
    };
  });
  const retainedEntryKeys = [
    ...previousByEntryKey.keys(),
    ...current.retainedEntryKeys,
  ];
  return {
    generation,
    snapshot: { ...current, resources, retainedEntryKeys },
    staleRetainedCount,
  };
}

function effectiveProtectedPreviousEntryKey(
  previousByEntryKey: ReadonlyMap<
    string,
    Extract<GitReviewDocumentResource, { kind: "loaded" }>
  >,
  protectedEntryKey: string | null
): string | null {
  const protectedResource = protectedEntryKey
    ? previousByEntryKey.get(protectedEntryKey)
    : undefined;
  if (!protectedResource) {
    return null;
  }
  return isGitReviewDocumentReservable(protectedResource.document)
    ? protectedEntryKey
    : null;
}

function oldestUnprotectedPrevious(
  previousByEntryKey: ReadonlyMap<
    string,
    Extract<GitReviewDocumentResource, { kind: "loaded" }>
  >,
  protectedEntryKey: string | null
):
  | readonly [string, Extract<GitReviewDocumentResource, { kind: "loaded" }>]
  | null {
  for (const entry of previousByEntryKey) {
    if (entry[0] !== protectedEntryKey) {
      return entry;
    }
  }
  return null;
}

export function resolveReviewAnchor(
  pending: PendingReviewAnchor,
  currentItemIds: readonly string[]
): PierDiffViewAnchor | null {
  const current = new Set(currentItemIds);
  if (current.has(pending.anchor.id)) {
    return pending.anchor;
  }
  const oldIndex = pending.previousItemIds.indexOf(pending.anchor.id);
  if (oldIndex < 0) {
    return null;
  }
  for (
    let index = oldIndex + 1;
    index < pending.previousItemIds.length;
    index += 1
  ) {
    const successor = pending.previousItemIds[index];
    if (successor && current.has(successor)) {
      return { id: successor, offset: 0 };
    }
  }
  for (let index = oldIndex - 1; index >= 0; index -= 1) {
    const predecessor = pending.previousItemIds[index];
    if (predecessor && current.has(predecessor)) {
      return { id: predecessor, offset: 0 };
    }
  }
  return null;
}
