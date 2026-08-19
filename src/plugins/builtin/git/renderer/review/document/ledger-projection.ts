import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import { createReviewCollidingFileLabel } from "../../plugin-text.ts";
import type { GitReviewReadingSurface } from "../reading-surface.ts";
import { reviewGroupsForSurface } from "../surface-group.ts";
import {
  classifyReviewSlotBodyClass,
  isReviewSlotIncludedInBody,
} from "./body-class.ts";
import type { ReviewCommentIndex } from "./comment-projection.ts";
import {
  estimateReviewSlotItem,
  lineStatsFromReviewSlot,
  noticeReviewSlotItem,
  reviewStageControl,
} from "./estimates.ts";
import { orderReviewPresentationSlots } from "./presentation-order.ts";
import type { ReviewDocumentProjection } from "./projection-types.ts";
import type { GitReviewDocumentResource } from "./resource.ts";
import { projectReviewDocumentResource } from "./resource-projection.ts";
import { binaryFileStateNotice } from "./state-text.ts";

type ReviewSlot = GitReviewIndexEntry["renderSlots"][number];

/**
 * 正文表面投影：content 槽 + 二进制 notice 说明卡。
 * meta/unknown 不进 CodeView。notice **不** materialize patch。
 *
 * 显示集 id = 全部正文槽（content idle → estimate；notice → ready-notice）。
 * demand / seed 只调度 document 水合优先级（allowedBody），**不得**裁剪 id。
 * 折叠全部总高 = n×header+(n−1)×gap，n 必须是正文槽数。
 * estimate 是虚拟高度占位，不是「灰条进度条海」；正文灌载仍有界。
 *
 * 文件顺序 = `orderReviewPresentationSlots`（与侧栏树同一套 displayPath 序）。
 *
 * @see 2026-07-31-git-review-gold-standard-endstate-design.md §3–§5
 */
export function projectReviewLedger(options: {
  readonly allowedBodyEntryKeys?: ReadonlySet<string>;
  readonly authoritativeEntryKeys?: ReadonlySet<string>;
  /**
   * Must match sidebar tree collision labels. Defaults to
   * `createReviewCollidingFileLabel(context, locale)`.
   */
  readonly collidingFileLabel?: (name: string) => string;
  readonly comments?: ReviewCommentIndex;
  readonly commentsSeq?: number;
  readonly context: RendererPluginContext;
  readonly diffBase?: GitReviewReadingSurface;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly locale: string;
  readonly resourceByEntryKey: ReadonlyMap<string, GitReviewDocumentResource>;
  readonly sourceIndexGeneration?: number;
}): ReviewDocumentProjection {
  const entryKeyBySectionId = new Map<string, string>();
  const revisionBySectionId = new Map<string, string>();
  const itemsBySectionKey = new Map<string, PierDiffViewItem>();

  const collidingFileLabel =
    options.collidingFileLabel ??
    createReviewCollidingFileLabel(options.context, options.locale);

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
      ? projectReviewDocumentResource(
          resource,
          options.context,
          options.locale,
          options.comments,
          options.commentsSeq
        ).items
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
    // 无正文槽且无已渲染 body：不进 CodeView（meta/rename 海）
    if (slots.length === 0 && !hasRenderableBody) {
      continue;
    }
    for (const slot of slots) {
      const fromResource = projectedById.get(slot.sectionKey);
      // 金标准：loaded 但投影无 section → error，禁止静默回落 estimate
      let resolved = fromResource;
      if (resolved === undefined) {
        if (classifyReviewSlotBodyClass(slot) === "notice") {
          resolved = noticeReviewSlotItem({
            slot,
            stateNotice: binaryFileStateNotice(
              options.context,
              slot.targetPath,
              options.locale
            ),
          });
        } else if (resource?.kind === "loaded") {
          resolved = projectionMissingSectionItem(slot, options.context);
        } else if (resource?.kind !== "error") {
          // idle / loading / 缺资源：稳定账本挂 estimate（demand 不决定有无 id）
          resolved = estimateReviewLedgerSlot(entry, slot);
        }
      }
      if (resolved === undefined && resource?.kind === "error") {
        // error 资源但 slot 未在 projectFailed 中（过滤 content 后仍应有）
        resolved = disableReviewMutationControls(
          projectionMissingSectionItem(slot, options.context)
        );
      }
      if (resolved === undefined) {
        continue;
      }
      // 变更控件不因「正文还没读回」而禁用/隐藏：
      // stage / unstage 是路径操作（不需要令牌），discard 在点击时按需取令牌。
      // 否则大仓折叠全部后，几十个按钮会随正文逐个解锁 / 逐个冒出来。
      itemsBySectionKey.set(slot.sectionKey, resolved);
      entryKeyBySectionId.set(resolved.id, entry.entryKey);
      if (resource?.kind === "loaded" && mutationReady) {
        revisionBySectionId.set(slot.sectionKey, resource.document.revision);
      }
    }
  }

  const surfaceGroups =
    options.diffBase === undefined
      ? undefined
      : reviewGroupsForSurface(options.diffBase);
  const orderedSlots = orderReviewPresentationSlots(options.entries, {
    collidingFileLabel,
    ...(surfaceGroups === undefined ? {} : { groups: surfaceGroups }),
    includeSlot: isReviewSlotIncludedInBody,
  });

  const items: PierDiffViewItem[] = [];
  for (const row of orderedSlots) {
    const item = itemsBySectionKey.get(row.sectionKey);
    if (item === undefined) {
      continue;
    }
    items.push(item);
  }

  return {
    entryKeyBySectionId,
    items,
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
