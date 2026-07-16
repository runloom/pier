import type { ReviewDocumentDemand } from "./git-review-document-demand.ts";
import type { GitReviewDocumentResource } from "./git-review-document-resource.ts";

export function isMaterializedReviewResource(
  resource: GitReviewDocumentResource
): boolean {
  return resource.kind !== "idle";
}

/**
 * 代内粘性 materialized 集合：
 * - 离开 idle 即加入
 * - 从 index 消失即删除
 * - loader 回到 idle 且不再被 demand/selected/retained 覆盖时，在 allowReclaim 时回收
 * - 导航事务中禁止回收，避免 CodeView 拓扑反复增删导致闪屏
 * 返回按 index 顺序的稳定数组。
 */
export function nextMaterializedEntryKeys(options: {
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
    if (isMaterializedReviewResource(resource)) {
      next.add(entryKey);
      continue;
    }
    // idle：导航中或仍被 demand / selected / retained 保护时保留粘性。
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
    if (isMaterializedReviewResource(resource)) {
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
