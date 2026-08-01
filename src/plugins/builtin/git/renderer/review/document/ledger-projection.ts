import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import type { GitReviewReadingSurface } from "../reading-surface.ts";
import {
  GIT_REVIEW_PRESENTATION_GROUP_ORDER,
  reviewGroupsForSurface,
} from "../surface-group.ts";
import { isReviewSlotIncludedInBody } from "./body-class.ts";
import {
  estimateReviewSlotItem,
  lineStatsFromReviewSlot,
  reviewStageControl,
} from "./estimates.ts";
import type { ReviewDocumentProjection } from "./projection-types.ts";
import type { GitReviewDocumentResource } from "./resource.ts";
import { projectReviewDocumentResource } from "./resource-projection.ts";

type ReviewProjectionGroup = GitReviewGroup;
type ReviewSlot = GitReviewIndexEntry["renderSlots"][number];

interface ProjectedRow {
  readonly group: ReviewProjectionGroup;
  readonly item: PierDiffViewItem;
  readonly path: string;
}

const REVIEW_PROJECTION_GROUP_INDEX = new Map<ReviewProjectionGroup, number>(
  GIT_REVIEW_PRESENTATION_GROUP_ORDER.map((group, index) => [group, index])
);

/**
 * 正文表面投影：仅 content-bearing 槽（金标准 bodyClass）。
 * meta/notice/unknown 不进 CodeView。
 *
 * pending/estimate 只挂 demand 窗口（seed∪visible∪buffered∪selected），
 * **禁止**「全 content 一张假 estimate 卡」当进度条（大 staged 灰条海）。
 * loaded/error 始终保留（含 soft-retain 视口外）。
 *
 * @see 2026-07-31-git-review-gold-standard-endstate-design.md §3–§5
 */
export function projectReviewLedger(options: {
  readonly allowedBodyEntryKeys?: ReadonlySet<string>;
  readonly authoritativeEntryKeys?: ReadonlySet<string>;
  readonly context: RendererPluginContext;
  readonly diffBase?: GitReviewReadingSurface;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly locale: string;
  readonly measuredEstimateLinesByPath?: ReadonlyMap<string, number>;
  /**
   * 允许挂 estimate 骨架的 entryKey（demand/seed/pin）。
   * 省略 = 兼容旧测：全部 content 可挂 estimate。
   * 生产路径必须传入，避免全量 estimate 海。
   */
  readonly pendingEntryKeys?: ReadonlySet<string>;
  readonly resourceByEntryKey: ReadonlyMap<string, GitReviewDocumentResource>;
  readonly sourceIndexGeneration?: number;
}): ReviewDocumentProjection {
  const entryKeyBySectionId = new Map<string, string>();
  const revisionBySectionId = new Map<string, string>();
  const decorated: ProjectedRow[] = [];
  for (const entry of options.entries) {
    const resource = options.resourceByEntryKey.get(entry.entryKey);
    // allowedBody 只约束「优先灌 body / mutation 权威」，不得把已 loaded 盖回 estimate。
    // 否则 soft-retain / 视口外已水合文件会永远停在骨架屏。
    const inBodyPriority =
      options.allowedBodyEntryKeys === undefined ||
      options.allowedBodyEntryKeys.has(entry.entryKey);
    const hasRenderableBody =
      resource !== undefined &&
      (resource.kind === "loaded" || resource.kind === "error");
    // demand 外 idle/loading 不进正文（禁止灰条海）
    const allowPendingEstimate =
      options.pendingEntryKeys === undefined ||
      options.pendingEntryKeys.has(entry.entryKey);
    if (!(hasRenderableBody || allowPendingEstimate)) {
      continue;
    }
    const projected = hasRenderableBody
      ? projectReviewDocumentResource(resource, options.context, options.locale)
          .items
      : [];
    const projectedById = new Map(projected.map((item) => [item.id, item]));
    const mutationReady =
      resource?.kind === "loaded" &&
      inBodyPriority &&
      (options.authoritativeEntryKeys === undefined ||
        options.authoritativeEntryKeys.has(entry.entryKey));
    const slots = slotsForDiffBase(entry, options.diffBase).filter((slot) =>
      isReviewSlotIncludedInBody(slot)
    );
    for (const slot of slots) {
      const fromResource = projectedById.get(slot.sectionKey);
      // 金标准：loaded 但投影无 section → error，禁止静默回落 estimate
      let resolved = fromResource;
      if (resolved === undefined) {
        if (resource?.kind === "loaded") {
          resolved = projectionMissingSectionItem(slot, options.context);
        } else if (resource?.kind !== "error" && allowPendingEstimate) {
          resolved = estimateReviewLedgerSlot(
            entry,
            slot,
            options.measuredEstimateLinesByPath
          );
        }
      }
      if (resolved === undefined && resource?.kind === "error") {
        // error 资源但 slot 未在 projectFailed 中（过滤 content 后仍应有）
        const forced = projectionMissingSectionItem(slot, options.context);
        const item = gateReviewMutationControls(forced, false);
        decorated.push({ group: slot.group, item, path: entry.path });
        entryKeyBySectionId.set(item.id, entry.entryKey);
        continue;
      }
      if (resolved === undefined) {
        continue;
      }
      const item = gateReviewMutationControls(resolved, mutationReady);
      decorated.push({ group: slot.group, item, path: entry.path });
      entryKeyBySectionId.set(item.id, entry.entryKey);
      if (resource?.kind === "loaded" && mutationReady) {
        revisionBySectionId.set(slot.sectionKey, resource.document.revision);
      }
    }
  }
  decorated.sort(compareProjectedRows);
  return {
    entryKeyBySectionId,
    items: decorated.map((row) => row.item),
    revisionBySectionId,
    sourceIndexGeneration: options.sourceIndexGeneration ?? 0,
  };
}

function gateReviewMutationControls(
  item: PierDiffViewItem,
  mutationReady: boolean
): PierDiffViewItem {
  if (mutationReady) {
    return item;
  }
  return {
    ...item,
    ...(item.stageControl == null
      ? {}
      : { stageControl: { ...item.stageControl, busy: true } }),
  };
}

function compareProjectedRows(left: ProjectedRow, right: ProjectedRow): number {
  return (
    reviewProjectionGroupIndex(left.group) -
      reviewProjectionGroupIndex(right.group) ||
    left.path.localeCompare(right.path) ||
    left.item.id.localeCompare(right.item.id)
  );
}

function reviewProjectionGroupIndex(group: ReviewProjectionGroup): number {
  const index = REVIEW_PROJECTION_GROUP_INDEX.get(group);
  if (index === undefined) {
    throw new Error(`Missing Git review projection order for ${group}`);
  }
  return index;
}

function slotsForDiffBase(
  entry: GitReviewIndexEntry,
  diffBase: GitReviewReadingSurface | undefined
): readonly ReviewSlot[] {
  if (diffBase === undefined) {
    return entry.renderSlots;
  }
  const groups = reviewGroupsForSurface(diffBase);
  return entry.renderSlots.filter((slot) => groups.includes(slot.group));
}

function estimateReviewLedgerSlot(
  entry: GitReviewIndexEntry,
  slot: ReviewSlot,
  measuredEstimateLinesByPath: ReadonlyMap<string, number> | undefined
): PierDiffViewItem {
  if (measuredEstimateLinesByPath === undefined) {
    return estimateReviewSlotItem({ entry, slot });
  }
  return estimateReviewSlotItem({
    entry,
    measuredEstimateLinesByPath,
    slot,
  });
}

/** loaded 文档无匹配 section：产品 error，禁止永久 estimate 骨架。 */
function projectionMissingSectionItem(
  slot: ReviewSlot,
  context: RendererPluginContext
): PierDiffViewItem {
  const stageControl = reviewStageControl(slot.group, slot.status);
  const lineStats = lineStatsFromReviewSlot(slot);
  const notice = context.i18n.t(
    "ui.reviewDocumentLoadFailed",
    undefined,
    "Unable to load this change"
  );
  return {
    cacheKey: `git-review-error:${slot.sectionKey}:projection-empty`,
    fileDisplay: {
      path: slot.targetPath,
      status: slot.status,
      ...(slot.oldPath === null ? {} : { previousPath: slot.oldPath }),
    },
    id: slot.sectionKey,
    kind: "error",
    ...(lineStats === undefined ? {} : { lineStats }),
    patch: null,
    ...(stageControl === null ? {} : { stageControl }),
    stateNotice: notice,
  };
}
