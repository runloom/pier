import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import {
  estimateLinesForFileStatus,
  PIER_DIFF_DEFAULT_ESTIMATE_LINES,
  PIER_DIFF_ESTIMATE_SLOT_HEIGHT_PX,
  PIER_DIFF_MAX_ESTIMATE_BODY_LINES,
} from "@pier/ui/diff-view/items.ts";
import type {
  GitReviewFileStatus,
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import type { GitReviewReadingSurface } from "../reading-surface.ts";
import { reviewGroupsForSurface } from "../surface-group.ts";

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

export function reviewEntryStageControl(
  entry: GitReviewIndexEntry
): ReturnType<typeof reviewStageControl> {
  const groups = new Set(entry.renderSlots.map((slot) => slot.group));
  if (groups.has("conflict") || groups.has("committed")) {
    return null;
  }
  if (groups.has("staged") && groups.has("unstaged")) {
    return reviewStageControl("partial", entry.status);
  }
  return reviewStageControl(
    groups.has("staged") ? "staged" : "unstaged",
    entry.status
  );
}

export function estimateReviewEntryItem(options: {
  readonly entry: GitReviewIndexEntry;
  readonly measuredEstimateLinesByPath?: ReadonlyMap<string, number>;
}): PierDiffViewItem {
  const slot = options.entry.renderSlots[0];
  if (slot === undefined) {
    throw new Error("Git Review entry 缺少导航槽");
  }
  const stageControl = reviewEntryStageControl(options.entry);
  const estimateLines =
    options.measuredEstimateLinesByPath?.get(options.entry.path) ??
    Math.max(...options.entry.renderSlots.map(estimateLinesForReviewSlot));
  const lineStats = lineStatsFromReviewSlot(slot);
  return {
    cacheKey: `${GIT_REVIEW_ESTIMATE_CACHE_PREFIX}${options.entry.entryKey}`,
    estimateLines,
    fileDisplay: {
      path: options.entry.path,
      status: options.entry.status,
      ...(options.entry.oldPaths[0] === undefined
        ? {}
        : { previousPath: options.entry.oldPaths[0] }),
    },
    id: options.entry.entryKey,
    kind: "estimate",
    ...(lineStats === undefined ? {} : { lineStats }),
    patch: null,
    ...(stageControl === null ? {} : { stageControl }),
  };
}

/** estimate 槽 cacheKey 前缀（可 scroll；非历史 git-review-placeholder）。 */
export const GIT_REVIEW_ESTIMATE_CACHE_PREFIX = "estimate:";

export function estimateReviewSlotItem(options: {
  readonly entry: GitReviewIndexEntry;
  readonly measuredEstimateLinesByPath?: ReadonlyMap<string, number>;
  readonly slot: GitReviewIndexEntry["renderSlots"][number];
  /** index/numstat 行数提示；缺省按 status 启发式。 */
  readonly estimateLines?: number;
}): PierDiffViewItem {
  const { entry: _entry, slot } = options;
  const stageControl = reviewStageControl(slot.group, slot.status);
  const estimateLines =
    options.estimateLines ??
    options.measuredEstimateLinesByPath?.get(options.entry.path) ??
    estimateLinesForReviewSlot(slot);
  const lineStats = lineStatsFromReviewSlot(slot);
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
    ...(lineStats === undefined ? {} : { lineStats }),
    patch: null,
    ...(stageControl === null ? {} : { stageControl }),
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

/**
 * estimate 正文行数只服务「骨架几何」，不是真 diff 行数。
 * 禁止用 numstat(add+del) 灌出几十行透明空行——会像坏掉的空白文件
 * （header 的 -N +M 仍走 lineStats，与此解耦）。
 */
/** 与 PIER_DIFF_ESTIMATE_SKELETON_LINES（5 条）几何单源对齐。 */
export const GIT_REVIEW_ESTIMATE_SKELETON_LINES = 5;

export function estimateLinesForReviewSlot(
  slot: GitReviewIndexEntry["renderSlots"][number]
): number {
  if (slot.binary === true) {
    return 1;
  }
  if (slot.additions !== undefined && slot.deletions !== undefined) {
    const lines = (slot.additions ?? 0) + (slot.deletions ?? 0);
    // pure rename / empty：0 行，禁止再灌假高
    if (lines === 0) {
      return 0;
    }
    // 有改动：固定矮骨架，避免 -5+42 → 47 行空白 gutter
    return GIT_REVIEW_ESTIMATE_SKELETON_LINES;
  }
  // renamed 无 numstat：不再估 12 假行（正文默认也不挂 meta）
  if (slot.status === "renamed") {
    return 0;
  }
  return Math.min(
    GIT_REVIEW_ESTIMATE_SKELETON_LINES,
    estimateLinesForFileStatus(slot.status)
  );
}

export function recordReviewRenderedHeightEstimates(
  entries: readonly GitReviewIndexEntry[],
  heightsBySectionId: ReadonlyMap<string, number>,
  measuredEstimateLinesByPath: Map<string, number>,
  diffBase?: GitReviewReadingSurface
): void {
  for (const entry of entries) {
    const sectionIds = entry.renderSlots
      .filter(
        (slot) =>
          diffBase === undefined ||
          reviewGroupsForSurface(diffBase).includes(slot.group)
      )
      .map((slot) => slot.sectionKey);
    const heights = sectionIds.flatMap((sectionId) => {
      const height = heightsBySectionId.get(sectionId);
      return height === undefined ? [] : [height];
    });
    if (heights.length === 0) {
      continue;
    }
    const estimatedLines = Math.min(
      PIER_DIFF_MAX_ESTIMATE_BODY_LINES,
      Math.max(
        1,
        Math.round(
          (Math.max(...heights) / PIER_DIFF_ESTIMATE_SLOT_HEIGHT_PX) *
            PIER_DIFF_DEFAULT_ESTIMATE_LINES
        )
      )
    );
    measuredEstimateLinesByPath.set(entry.path, estimatedLines);
  }
}
