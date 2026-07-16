import type { ReviewDocumentDemand } from "./git-review-document-demand.ts";
import type { GitReviewDocumentResource } from "./git-review-document-resource.ts";

/** 非 idle 资源：已进入 loader 生命周期，可供 demand/lookahead 覆盖跟踪。 */
export function isActiveReviewResource(
  resource: GitReviewDocumentResource
): boolean {
  return resource.kind !== "idle";
}

/**
 * demand 预取覆盖集合（不是 CodeView 成员集）：
 * - 离开 idle 即加入，供 lookahead 锚点
 * - 从 index 消失即删除
 * - loader 回到 idle 且不再被 demand/selected/retained 覆盖时，在 allowReclaim 时回收
 * - 导航事务中禁止回收，避免 seed/window 抖动导致重复预取
 * 返回按 index 顺序的稳定数组。
 *
 * CodeView 成员始终 = 全量轻量槽；本集合只影响 seed/window/lookahead demand。
 */
export function nextDemandPrefetchEntryKeys(options: {
  readonly allowReclaim?: boolean;
  readonly demand: ReviewDocumentDemand;
  readonly entryKeysInOrder: readonly string[];
  readonly previous: ReadonlySet<string>;
  readonly retainedEntryKeys: ReadonlySet<string>;
  readonly resourceByEntryKey: ReadonlyMap<string, GitReviewDocumentResource>;
  readonly selectedEntryKey: string | null;
}): string[] {
  const allowReclaim = options.allowReclaim !== false;
  const indexKeys = new Set(options.entryKeysInOrder);
  const demanded = new Set([
    ...options.demand.visibleEntryKeys,
    ...options.demand.bufferedEntryKeys,
  ]);
  const next = new Set<string>();

  for (const entryKey of options.previous) {
    if (!indexKeys.has(entryKey)) {
      continue;
    }
    const resource = options.resourceByEntryKey.get(entryKey);
    if (resource === undefined) {
      continue;
    }
    if (isActiveReviewResource(resource)) {
      next.add(entryKey);
      continue;
    }
    // idle：导航中或仍被 demand / selected / retained 保护时保留预取覆盖。
    if (
      !allowReclaim ||
      demanded.has(entryKey) ||
      entryKey === options.selectedEntryKey ||
      options.retainedEntryKeys.has(entryKey)
    ) {
      next.add(entryKey);
    }
  }

  for (const [entryKey, resource] of options.resourceByEntryKey) {
    if (!indexKeys.has(entryKey)) {
      continue;
    }
    if (isActiveReviewResource(resource)) {
      next.add(entryKey);
    }
  }

  return options.entryKeysInOrder.filter((entryKey) => next.has(entryKey));
}

export function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}
