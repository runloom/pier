import type { CodeViewItem } from "@pierre/diffs/react";
import type { PierHunkAnnotationMetadata } from "./diff-view-hunk-actions.tsx";
import type { PierDiffCodeViewItem } from "./diff-view-items.ts";

export type DiffViewItemTransitionPlan =
  | { readonly kind: "append" }
  | { readonly kind: "clear" }
  | { readonly kind: "initialize" }
  | { readonly kind: "reconcile" }
  | {
      readonly kind: "rename";
      readonly renames: readonly (readonly [string, string])[];
    }
  | { readonly kind: "update" };

/**
 * stage 换 sectionKey 且路径 1:1 可对齐时，返回 updateItemId 对；
 * 槽位数变化 / 同 path 多槽 → null，走 setItems reconcile。
 */
export function planPathAlignedIdRenames(
  previousItems: readonly PierDiffCodeViewItem[],
  nextItems: readonly PierDiffCodeViewItem[]
): readonly (readonly [string, string])[] | null {
  if (previousItems.length !== nextItems.length || previousItems.length === 0) {
    return null;
  }
  const previousByPath = new Map<string, PierDiffCodeViewItem[]>();
  const nextByPath = new Map<string, PierDiffCodeViewItem[]>();
  for (const item of previousItems) {
    const path = codeViewItemPath(item);
    if (path === null) {
      return null;
    }
    const bucket = previousByPath.get(path) ?? [];
    bucket.push(item);
    previousByPath.set(path, bucket);
  }
  for (const item of nextItems) {
    const path = codeViewItemPath(item);
    if (path === null) {
      return null;
    }
    const bucket = nextByPath.get(path) ?? [];
    bucket.push(item);
    nextByPath.set(path, bucket);
  }
  if (previousByPath.size !== nextByPath.size) {
    return null;
  }
  const renames: (readonly [string, string])[] = [];
  for (const [path, prevBucket] of previousByPath) {
    const nextBucket = nextByPath.get(path);
    // 同 path 多槽（半暂存双 section）无法安全 1:1 rename
    if (
      nextBucket === undefined ||
      prevBucket.length !== 1 ||
      nextBucket.length !== 1
    ) {
      return null;
    }
    const prevItem = prevBucket[0];
    const nextItem = nextBucket[0];
    if (prevItem === undefined || nextItem === undefined) {
      return null;
    }
    if (prevItem.id !== nextItem.id) {
      renames.push([prevItem.id, nextItem.id]);
    }
  }
  // 目标 id 不得与仍保留的旧 id 冲突
  const nextIds = new Set(nextItems.map((item) => item.id));
  const prevIds = new Set(previousItems.map((item) => item.id));
  for (const [oldId, newId] of renames) {
    if (prevIds.has(newId) && oldId !== newId) {
      // newId 仍被另一 previous 占用 → 需交换或 setItems
      const stillOwned = previousItems.some(
        (item) => item.id === newId && item.id !== oldId
      );
      if (stillOwned) {
        return null;
      }
    }
    if (!nextIds.has(newId)) {
      return null;
    }
  }
  return renames;
}

export function codeViewItemPath(item: PierDiffCodeViewItem): string | null {
  if (item.type === "diff") {
    return item.fileDiff.name.length > 0 ? item.fileDiff.name : null;
  }
  if (item.type === "file") {
    return item.file.name.length > 0 ? item.file.name : null;
  }
  return null;
}

/** 把成员迁移先归类，再由同步器执行；暂存路径不会散落成隐式分支。 */
export function planDiffViewItemTransition(
  previousItems: readonly PierDiffCodeViewItem[] | null,
  nextItems: readonly PierDiffCodeViewItem[]
): DiffViewItemTransitionPlan {
  if (nextItems.length === 0) {
    return (previousItems?.length ?? 0) === 0
      ? { kind: "update" }
      : { kind: "clear" };
  }
  if (previousItems === null || previousItems.length === 0) {
    return { kind: "initialize" };
  }
  if (hasSameCodeViewItemIdOrder(previousItems, nextItems)) {
    return { kind: "update" };
  }
  if (isStrictIdPrefix(previousItems, nextItems)) {
    return { kind: "append" };
  }
  const renames = planPathAlignedIdRenames(previousItems, nextItems);
  if (renames !== null) {
    return { kind: "rename", renames };
  }
  return { kind: "reconcile" };
}

export function hasSameCodeViewItemIdOrder(
  previous: readonly CodeViewItem<PierHunkAnnotationMetadata>[],
  next: readonly CodeViewItem<PierHunkAnnotationMetadata>[]
): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index]?.id !== next[index]?.id) {
      return false;
    }
  }
  return true;
}

function isStrictIdPrefix(
  previous: readonly CodeViewItem<PierHunkAnnotationMetadata>[],
  next: readonly CodeViewItem<PierHunkAnnotationMetadata>[]
): boolean {
  if (next.length <= previous.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index]?.id !== next[index]?.id) {
      return false;
    }
  }
  return true;
}
