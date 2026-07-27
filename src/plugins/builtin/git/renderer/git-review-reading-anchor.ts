/**
 * P0 阅读连续 / 空间稳定：内容锚点策略（非钉 scrollTop）。
 *
 * 完成标准（用户确认）：
 * - R1 同 membership 序 + 同 id 仅高度变 → 外层不抢（Pierre 行锚）
 * - R1b 同 id + 拓扑变（半暂存上方插槽）→ 外层也不抢；Pierre reconcile + 行锚
 * - R2 半暂存 id 丢失：操作侧仍在 → 必须操作侧，禁止 staged 第一槽
 * - R3 再次 stage：同 R1/R1b/R2
 * - R4 操作侧消失 → neighborhood（不跟同 entry staged 默认）
 * - R7 禁止 raw scrollTop 作内容/拓扑主策略
 *
 * 重要：外层 item 级 restoreAnchor/scrollTo 会清掉 Pierre pendingLayoutAnchor，
 * 且在 setItems 异步 recompute 前用陈旧 top，是 stage 闪一下的主因。
 * 同 id 存活时禁止外层 scrollTo。
 */

import type { PierDiffViewAnchor } from "@pier/ui/diff-view.tsx";

/** 用户操作/阅读所在侧（uncommitted）。 */
export type ReviewReadingSide = "staged" | "unstaged" | "other";

/**
 * 整文件 stage 完（操作侧 section 消失）时的落点。
 * P0 钉死：neighborhood（原邻域 / 下一存活 id）。
 */
export type ReviewFullStageLanding = "neighborhood";

export const REVIEW_FULL_STAGE_LANDING: ReviewFullStageLanding = "neighborhood";

export interface ReviewReadingAnchorPending {
  readonly anchor: PierDiffViewAnchor;
  readonly entryKey: string | null;
  /** 采锚时阅读侧；半暂存 remap 优先此侧。 */
  readonly preferredSide: ReviewReadingSide;
  readonly previousItemIds: readonly string[];
}

export interface ResolveReviewReadingAnchorOptions {
  readonly currentItemIds: readonly string[];
  readonly entryKeyBySectionId: ReadonlyMap<string, string>;
  readonly fullStageLanding?: ReviewFullStageLanding;
  readonly pending: ReviewReadingAnchorPending;
  /**
   * 当前账本 sectionKey → side。
   * 半暂存时用来挑「仍存活的操作侧」槽。
   */
  readonly sideBySectionId: ReadonlyMap<string, ReviewReadingSide>;
}

export function readingSideFromStageState(
  state: "staged" | "unstaged" | undefined
): ReviewReadingSide {
  if (state === "staged") {
    return "staged";
  }
  if (state === "unstaged") {
    return "unstaged";
  }
  return "other";
}

/** membership 序或集合是否变化（含上方插入、换 id）。 */
export function didMembershipTopologyChange(
  previousItemIds: readonly string[],
  currentItemIds: readonly string[]
): boolean {
  if (previousItemIds.length !== currentItemIds.length) {
    return true;
  }
  for (let index = 0; index < previousItemIds.length; index += 1) {
    if (previousItemIds[index] !== currentItemIds[index]) {
      return true;
    }
  }
  return false;
}

/**
 * 解析内容锚点（仅 id 丢失时由外层调用）。
 */
export function resolveReviewReadingAnchor(
  options: ResolveReviewReadingAnchorOptions
): PierDiffViewAnchor | null {
  const { currentItemIds, entryKeyBySectionId, pending, sideBySectionId } =
    options;
  if (pending.anchor.id.length === 0) {
    return null;
  }
  const current = new Set(currentItemIds);

  // 同 id 仍在：外层不应 restore；若误调用则原样返回（调用方应先 shouldRestore）
  if (current.has(pending.anchor.id)) {
    return pending.anchor;
  }

  const entryKey = pending.entryKey;
  if (entryKey != null) {
    const sameEntryIds = currentItemIds.filter(
      (id) => entryKeyBySectionId.get(id) === entryKey
    );

    // R2：操作侧仍在 → 必须锚操作侧（禁止扫到 staged 第一槽）
    if (pending.preferredSide !== "other") {
      const preferredAlive = sameEntryIds.find(
        (id) => sideBySectionId.get(id) === pending.preferredSide
      );
      if (preferredAlive !== undefined) {
        return {
          id: preferredAlive,
          offset: pending.anchor.offset,
        };
      }
    }
  }

  // R4 neighborhood：按 previousItemIds 顺序找仍存活的后继/前驱
  // 故意不默认同 entry 的另一侧（避免半暂存/整 stage 误跟 staged）
  return resolveNeighborhoodAnchor(pending, current);
}

function resolveNeighborhoodAnchor(
  pending: ReviewReadingAnchorPending,
  current: ReadonlySet<string>
): PierDiffViewAnchor | null {
  const oldIndex = pending.previousItemIds.indexOf(pending.anchor.id);
  if (oldIndex < 0) {
    const first = [...current][0];
    return first === undefined ? null : { id: first, offset: 0 };
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
  const first = [...current][0];
  return first === undefined ? null : { id: first, offset: 0 };
}

/**
 * settle 后是否应外层内容 restore。
 *
 * - 同 id 仍在（含 R1b 半暂存上方插槽）→ false：Pierre reconcile 行锚
 * - id 丢失 → true：R2 preferredSide / R4 neighborhood
 *
 * 禁止对同 id 外层 scrollTo：会清 Pierre pendingLayoutAnchor 并用陈旧 top。
 */
export function shouldRestoreReadingAnchorExternally(
  pending: Pick<ReviewReadingAnchorPending, "anchor" | "previousItemIds">,
  currentItemIds: readonly string[]
): boolean {
  if (pending.anchor.id.length === 0) {
    return false;
  }
  return !currentItemIds.includes(pending.anchor.id);
}
