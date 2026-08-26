import { PIER_DIFF_ESTIMATE_SKELETON_LINES } from "@pier/ui/diff-view/estimate-skeleton.ts";
import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import type {
  GitReviewFileStatus,
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";

/** Uncommitted stage control for multi-diff headers; null when not toggleable. */
export function reviewStageControl(
  group: GitReviewGroup | "partial",
  status: GitReviewFileStatus
): {
  readonly canDiscard?: boolean;
  readonly state: "partial" | "staged" | "unstaged";
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
    case "partial":
      return { state: "partial" };
    case "conflict":
    case "committed":
      return null;
    default:
      return null;
  }
}

/** estimate 槽 cacheKey 前缀（可 scroll）。 */
export const GIT_REVIEW_ESTIMATE_CACHE_PREFIX = "estimate:";

/**
 * 与 PIER_DIFF_ESTIMATE_SKELETON_LINES 单源对齐。
 * 仅文档/绘制语义；虚拟高度走 geometry.slotVirtualHeight（骨架槽，不读 numstat）。
 */
export const GIT_REVIEW_ESTIMATE_SKELETON_LINES: number =
  PIER_DIFF_ESTIMATE_SKELETON_LINES;

/** estimate 槽：0 正文；高度由 geometry 在 CodeView 布局层决定。 */
export function estimateReviewSlotItem(options: {
  readonly entry: GitReviewIndexEntry;
  readonly slot: GitReviewIndexEntry["renderSlots"][number];
}): PierDiffViewItem {
  const { slot } = options;
  const stageControl = reviewStageControl(slot.group, slot.status);
  const lineStats = lineStatsFromReviewSlot(slot);
  return {
    cacheKey: `${GIT_REVIEW_ESTIMATE_CACHE_PREFIX}${slot.sectionKey}`,
    fileDisplay: {
      path: slot.targetPath,
      status: slot.status,
      ...(slot.oldPath === null ? {} : { previousPath: slot.oldPath }),
    },
    id: slot.sectionKey,
    kind: "estimate",
    ...(lineStats === undefined ? {} : { lineStats }),
    patch: null,
    ...(stageControl === null ? {} : { stageControl }),
  };
}

/** 二进制 notice：不 hydrate，index 即可出说明卡。 */
export function noticeReviewSlotItem(options: {
  readonly slot: GitReviewIndexEntry["renderSlots"][number];
  readonly stateNotice: string;
}): PierDiffViewItem {
  const { slot, stateNotice } = options;
  const stageControl = reviewStageControl(slot.group, slot.status);
  return {
    cacheKey: JSON.stringify(["notice", slot.sectionKey, stateNotice]),
    fileDisplay: {
      path: slot.targetPath,
      status: slot.status,
      ...(slot.oldPath === null ? {} : { previousPath: slot.oldPath }),
    },
    id: slot.sectionKey,
    kind: "ready-notice",
    patch: null,
    ...(stageControl === null ? {} : { stageControl }),
    stateNotice,
  };
}

/** index numstat → header 首屏 +N −M（不依赖 patch 是否已 materialize）。 */
export function lineStatsFromReviewSlot(
  slot: GitReviewIndexEntry["renderSlots"][number]
): { readonly additions: number; readonly deletions: number } | undefined {
  if (slot.binary === true) {
    return;
  }
  if (
    typeof slot.additions === "number" &&
    typeof slot.deletions === "number" &&
    (slot.additions > 0 || slot.deletions > 0)
  ) {
    return { additions: slot.additions, deletions: slot.deletions };
  }
  return;
}
