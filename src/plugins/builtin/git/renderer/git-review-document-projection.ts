import type {
  PierDiffViewAnchor,
  PierDiffViewItem,
} from "@pier/ui/diff-view.tsx";
import { estimateLinesForFileStatus } from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFileStatus,
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";
import type {
  GitReviewDocumentLoaderSnapshot,
  GitReviewDocumentResource,
} from "./git-review-document-resource.ts";
import { stateSectionText } from "./git-review-document-state-text.ts";
import type { ReviewReadingSide } from "./git-review-reading-anchor.ts";

/** 轻量 32-bit FNV-1a，给 patch cacheKey 叠内容指纹。 */
function fnv1a32(text: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < text.length; index += 1) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a unsigned coerce
  return (hash >>> 0).toString(16);
}

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
        // VS Code clean: tracked modified/deleted + untracked added.
        canDiscard:
          status === "modified" || status === "deleted" || status === "added",
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
  /**
   * 采锚时阅读侧（P0：半暂存 remap 优先此侧）。
   */
  readonly preferredSide: ReviewReadingSide;
  readonly previousItemIds: readonly string[];
  readonly restored: boolean;
  /**
   * Generation 开始时的 raw scrollTop 快照。
   * 仅 identity 丢失兜底的次级线索；主策略是内容锚点。
   */
  readonly scrollTop: number | null;
}

/**
 * 能否挂 **loaded 正文**（非「能否进账本」）。
 * 账本身份集 = 全 index renderSlots；见 projectReviewLedger。
 */
export function isCodeViewMemberResource(
  resource: GitReviewDocumentResource
): boolean {
  return resource.kind === "loaded" || resource.kind === "error";
}

/** estimate 槽 cacheKey 前缀（可 scroll；非历史 git-review-placeholder）。 */
export const GIT_REVIEW_ESTIMATE_CACHE_PREFIX = "estimate:";

export function estimateReviewSlotItem(options: {
  readonly entry: GitReviewIndexEntry;
  readonly slot: GitReviewIndexEntry["renderSlots"][number];
  /** index/numstat 行数提示；缺省按 status 启发式。 */
  readonly estimateLines?: number;
}): PierDiffViewItem {
  const { entry: _entry, slot } = options;
  const stageControl = reviewStageControl(slot.group, slot.status);
  const estimateLines =
    options.estimateLines ?? estimateLinesForFileStatus(slot.status);
  return {
    cacheKey: `${GIT_REVIEW_ESTIMATE_CACHE_PREFIX}${slot.sectionKey}`,
    estimateLines,
    fileDisplay: {
      path: slot.targetPath,
      status: slot.status,
      ...(slot.oldPath === null ? {} : { previousPath: slot.oldPath }),
    },
    id: slot.sectionKey,
    kind: "estimate",
    patch: null,
    ...(stageControl === null ? {} : { stageControl }),
  };
}

/**
 * 稳定高度账本投影（stable-ledger）：
 * 每个 index renderSlot 恰好一个 item；body 缺失 → estimate。
 */
export function projectReviewLedger(options: {
  readonly context: RendererPluginContext;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly locale: string;
  readonly resourceByEntryKey: ReadonlyMap<string, GitReviewDocumentResource>;
}): ReviewDocumentProjection {
  const { context, entries, locale, resourceByEntryKey } = options;
  const entryKeyBySectionId = new Map<string, string>();
  const decorated: {
    readonly group: GitReviewGroup;
    readonly item: PierDiffViewItem;
    readonly path: string;
    readonly sectionKey: string;
  }[] = [];

  for (const entry of entries) {
    const resource = resourceByEntryKey.get(entry.entryKey);
    for (const slot of entry.renderSlots) {
      entryKeyBySectionId.set(slot.sectionKey, entry.entryKey);
      const item = projectReviewLedgerSlot({
        context,
        entry,
        locale,
        resource,
        slot,
      });
      decorated.push({
        group: slot.group,
        item,
        path: entry.path,
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
    items: decorated.map((row) => row.item),
  };
}

function projectReviewLedgerSlot(options: {
  readonly context: RendererPluginContext;
  readonly entry: GitReviewIndexEntry;
  readonly locale: string;
  readonly resource: GitReviewDocumentResource | undefined;
  readonly slot: GitReviewIndexEntry["renderSlots"][number];
}): PierDiffViewItem {
  const { context, entry, locale, resource, slot } = options;
  if (resource?.kind === "error") {
    const notice = context.i18n.t(
      "ui.reviewDocumentLoadFailed",
      undefined,
      "Unable to load this change"
    );
    const stageControl = reviewStageControl(slot.group, slot.status);
    return {
      cacheKey: `git-review-error:${slot.sectionKey}:${resource.failure.reason}`,
      fileDisplay: {
        path: slot.targetPath,
        status: slot.status,
        ...(slot.oldPath === null ? {} : { previousPath: slot.oldPath }),
      },
      id: slot.sectionKey,
      kind: "error",
      patch: null,
      stateNotice: notice,
      ...(stageControl === null ? {} : { stageControl }),
    };
  }
  if (resource?.kind === "loaded") {
    const projected = projectReviewDocumentResource(resource, context, locale);
    const match = projected.items.find((item) => item.id === slot.sectionKey);
    if (match !== undefined) {
      if (match.kind !== undefined) {
        return match;
      }
      let inferredKind: "ready-notice" | "estimate" | "loaded" = "loaded";
      if (match.stateNotice !== undefined && match.stateNotice.length > 0) {
        inferredKind = "ready-notice";
      } else if (match.patch === null) {
        inferredKind = "estimate";
      }
      return { ...match, kind: inferredKind };
    }
  }
  return estimateReviewSlotItem({ entry, slot });
}

/**
 * 仅投影 snapshot 内 loaded|error（legacy subset）。
 * 全账本路径用 projectReviewLedger。
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
    if (!isCodeViewMemberResource(resource)) {
      continue;
    }
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

/** 全量 index：sectionKey → entryKey（不依赖 CodeView 成员）。 */
export function indexReviewSectionEntries(
  entries: readonly GitReviewIndexEntry[]
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    for (const slot of entry.renderSlots) {
      map.set(slot.sectionKey, entry.entryKey);
    }
  }
  return map;
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
  if (!(resource.kind === "loaded" || resource.kind === "error")) {
    return { items: [] };
  }

  if (resource.kind === "error") {
    const notice = context.i18n.t(
      "ui.reviewDocumentLoadFailed",
      undefined,
      "Unable to load this change"
    );
    const items = resource.entry.renderSlots.map((slot): PierDiffViewItem => {
      const stageControl = reviewStageControl(slot.group, slot.status);
      return {
        cacheKey: `git-review-error:${slot.sectionKey}:${resource.failure.reason}`,
        fileDisplay: {
          path: slot.targetPath,
          status: slot.status,
          ...(slot.oldPath === null ? {} : { previousPath: slot.oldPath }),
        },
        id: slot.sectionKey,
        kind: "error",
        patch: null,
        stateNotice: notice,
        ...(stageControl === null ? {} : { stageControl }),
      };
    });
    return { items };
  }

  const document = resource.document;
  const sectionsByKey = new Map(
    document.sections.map((section) => [section.sectionKey, section])
  );
  const items = resource.entry.renderSlots.flatMap(
    (slot): PierDiffViewItem[] => {
      const section = sectionsByKey.get(slot.sectionKey);
      const stageControl = reviewStageControl(slot.group, slot.status);
      const fileDisplay = {
        path: slot.targetPath,
        status: slot.status,
        ...(slot.oldPath === null ? {} : { previousPath: slot.oldPath }),
      };
      // loaded 但缺 section：退回 estimate（由 ledger 填）
      if (section === undefined) {
        return [];
      }
      if (section.kind === "state") {
        const stateText = stateSectionText(context, section, locale);
        return [
          {
            cacheKey: JSON.stringify([
              document.revision,
              section.sectionKey,
              locale,
              section.targetPath,
              section.oldPath,
              section.status,
              stateText,
            ]),
            fileDisplay,
            id: section.sectionKey,
            kind: "ready-notice",
            patch: null,
            stateNotice: stateText,
            ...(stageControl === null ? {} : { stageControl }),
          },
        ];
      }
      return [
        {
          cacheKey: `${document.revision}:${section.sectionKey}:${section.patch.length}:${fnv1a32(section.patch)}`,
          fileDisplay,
          id: section.sectionKey,
          kind: "loaded",
          patch: section.patch,
          ...(stageControl === null ? {} : { stageControl }),
        },
      ];
    }
  );
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

export { reconcileReviewDocumentSnapshot } from "./git-review-document-reconcile.ts";
export {
  type ReviewReadingRestoreResult,
  resolveReviewAnchor,
  restoreReviewReadingViewport,
  restoreReviewViewportFreeze,
} from "./git-review-document-viewport.ts";
