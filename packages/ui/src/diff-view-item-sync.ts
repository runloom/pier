import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
import type { PierHunkAnnotationMetadata } from "./diff-view-hunk-actions.tsx";
import type { PierDiffCodeViewItem } from "./diff-view-items.ts";

export type PierCodeViewHandle = CodeViewHandle<PierHunkAnnotationMetadata>;

/**
 * version 是「内容版本 + 折叠修订」的单调计数:同 id 同 version 意味着
 * CodeView 已持有等价记录(常见于折叠后重投影产生的新克隆)。
 * CodeView.updateItem 对同版本更新返回 false,不能把它当作拒绝。
 */
export function acceptDiffViewItem(
  handle: PierCodeViewHandle,
  item: PierDiffCodeViewItem
): boolean {
  const current = handle.getItem(item.id);
  if (current === item) {
    return true;
  }
  if (current !== undefined && (current.version ?? 0) === (item.version ?? 0)) {
    return true;
  }
  return handle.updateItem(item);
}

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

/**
 * DiffsHub 风格：同一 CodeView 实例内消化成员与正文变更。
 * - 前缀 id 不变 → 前缀 updateItem + 尾部 addItems
 * - 同序同成员 → 仅 updateItem
 * - 路径 1:1 sectionKey 迁移 → updateItemId + updateItem
 * - 其余 → instance.setItems → tryAppend / reconcile
 */
export function syncCodeViewItems(
  handle: PierCodeViewHandle,
  nextItems: readonly PierDiffCodeViewItem[],
  previousItems: readonly PierDiffCodeViewItem[] | null
): boolean {
  const instance = handle.getInstance();
  if (!instance) {
    return false;
  }

  if (nextItems.length === 0) {
    if ((previousItems?.length ?? 0) === 0) {
      return true;
    }
    instance.setItems([]);
    return true;
  }

  if (previousItems == null || previousItems.length === 0) {
    if (instanceAlreadyMatches(handle, nextItems)) {
      return applyContentUpdates(handle, nextItems, previousItems ?? []);
    }
    instance.setItems([...nextItems]);
    return true;
  }

  if (isSameIdOrder(previousItems, nextItems)) {
    return applyContentUpdates(handle, nextItems, previousItems);
  }

  if (isStrictIdPrefix(previousItems, nextItems)) {
    if (
      !applyContentUpdates(
        handle,
        nextItems.slice(0, previousItems.length),
        previousItems
      )
    ) {
      return false;
    }
    const tail = nextItems.slice(previousItems.length);
    if (tail.length > 0) {
      handle.addItems(tail);
    }
    return true;
  }

  // stage 换 sectionKey：路径 1:1 时 updateItemId 保 instance
  const renames = planPathAlignedIdRenames(previousItems, nextItems);
  if (renames !== null) {
    for (const [oldId, newId] of renames) {
      if (!handle.updateItemId(oldId, newId)) {
        instance.setItems([...nextItems]);
        return true;
      }
    }
    // rename 后按 next 顺序：若 id 序已对齐则只更正文，否则 reconcile
    const renamedPrevious = previousItems.map((item) => {
      const hit = renames.find(([oldId]) => oldId === item.id);
      return hit === undefined ? item : { ...item, id: hit[1] };
    });
    if (isSameIdOrder(renamedPrevious, nextItems)) {
      return applyContentUpdates(handle, nextItems, renamedPrevious);
    }
    instance.setItems([...nextItems]);
    return true;
  }

  instance.setItems([...nextItems]);
  return true;
}

function instanceAlreadyMatches(
  handle: PierCodeViewHandle,
  nextItems: readonly PierDiffCodeViewItem[]
): boolean {
  for (const item of nextItems) {
    if (handle.getItem(item.id) === undefined) {
      return false;
    }
  }
  return nextItems.length > 0;
}

function isSameIdOrder(
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

function applyContentUpdates(
  handle: PierCodeViewHandle,
  nextItems: readonly PierDiffCodeViewItem[],
  previousItems: readonly PierDiffCodeViewItem[]
): boolean {
  let allAccepted = true;
  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  for (const item of nextItems) {
    const previous = previousById.get(item.id);
    if (previous === item) {
      continue;
    }
    if (!acceptDiffViewItem(handle, item)) {
      allAccepted = false;
    }
  }
  return allAccepted;
}
