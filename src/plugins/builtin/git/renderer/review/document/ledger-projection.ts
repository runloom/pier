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
 * 显示集 id = **全部 content 槽**（idle → estimate；loaded/error 照旧）。
 * demand / seed 只调度 document 水合优先级（allowedBody），**不得**裁剪 id。
 * 折叠全部总高 = n×header+(n−1)×gap，n 必须是 content 槽数。
 * estimate 是虚拟高度占位，不是「灰条进度条海」；正文灌载仍有界。
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
    // 无 content 槽且无已渲染 body：不进 CodeView（meta/rename 海）
    if (slots.length === 0 && !hasRenderableBody) {
      continue;
    }
    for (const slot of slots) {
      const fromResource = projectedById.get(slot.sectionKey);
      // 金标准：loaded 但投影无 section → error，禁止静默回落 estimate
      let resolved = fromResource;
      if (resolved === undefined) {
        if (resource?.kind === "loaded") {
          resolved = projectionMissingSectionItem(slot, options.context);
        } else if (resource?.kind !== "error") {
          // idle / loading / 缺资源：稳定账本挂 estimate（demand 不决定有无 id）
          resolved = estimateReviewLedgerSlot(entry, slot);
        }
      }
      if (resolved === undefined && resource?.kind === "error") {
        // error 资源但 slot 未在 projectFailed 中（过滤 content 后仍应有）
        const forced = projectionMissingSectionItem(slot, options.context);
        const item = disableReviewMutationControls(forced);
        decorated.push({ group: slot.group, item, path: entry.path });
        entryKeyBySectionId.set(item.id, entry.entryKey);
        continue;
      }
      if (resolved === undefined) {
        continue;
      }
      // 变更控件不因「正文还没读回」而禁用/隐藏：
      // stage / unstage 是路径操作（不需要令牌），discard 在点击时按需取令牌。
      // 否则大仓折叠全部后，几十个按钮会随正文逐个解锁 / 逐个冒出来。
      const item = resolved;
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

/** 读取失败的槽位：连路径操作都不提供，只留重试。 */
function disableReviewMutationControls(
  item: PierDiffViewItem
): PierDiffViewItem {
  if (item.stageControl == null) {
    return item;
  }
  return {
    ...item,
    stageControl: { ...item.stageControl, busy: true, canDiscard: false },
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
  slot: ReviewSlot
): PierDiffViewItem {
  return estimateReviewSlotItem({ entry, slot });
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
