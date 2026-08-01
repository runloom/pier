import type { CodeViewHandle, SelectionSide } from "@pierre/diffs/react";
import { DIFF_HEADER_HEIGHT_PX } from "./appearance.ts";
import type { PierHunkAnnotationMetadata } from "./hunk-actions.tsx";
import {
  hasSameCodeViewItemIdOrder,
  planDiffViewItemTransition,
  planPathAlignedIdRenames,
} from "./item-transition.ts";
import { isEstimateCodeViewItem, type PierDiffCodeViewItem } from "./items.ts";

export type PierCodeViewHandle = CodeViewHandle<PierHunkAnnotationMetadata>;

export type { DiffViewItemTransitionPlan } from "./item-transition.ts";
export {
  codeViewItemPath,
  planDiffViewItemTransition,
  planPathAlignedIdRenames,
} from "./item-transition.ts";

export type DiffViewAnchoredDisposition =
  | "empty"
  | "focused"
  | "noop"
  | "preserved";

export interface DiffViewAnchoredApplyResult {
  readonly accepted: boolean;
  readonly disposition: DiffViewAnchoredDisposition;
}

const MEMBERSHIP_LAYOUT_PASSES = 2;

type CapturedCodeViewAnchor =
  | {
      readonly id: string;
      readonly type: "item";
      readonly viewportOffset: number;
    }
  | {
      readonly id: string;
      readonly lineNumber: number;
      readonly side?: SelectionSide;
      readonly type: "line";
      readonly viewportOffset: number;
    };

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
  const plan = planDiffViewItemTransition(previousItems, nextItems);
  switch (plan.kind) {
    case "update": {
      if (applyContentUpdates(handle, nextItems, previousItems ?? [])) {
        return true;
      }
      instance.setItems([...nextItems]);
      return true;
    }
    case "clear":
      instance.setItems([]);
      return true;
    case "initialize":
      if (instanceAlreadyMatches(handle, nextItems)) {
        return applyContentUpdates(handle, nextItems, previousItems ?? []);
      }
      instance.setItems([...nextItems]);
      return true;
    case "append": {
      const stablePrefix = previousItems ?? [];
      if (
        !applyContentUpdates(
          handle,
          nextItems.slice(0, stablePrefix.length),
          stablePrefix
        )
      ) {
        instance.setItems([...nextItems]);
        return true;
      }
      const tail = nextItems.slice(stablePrefix.length);
      if (tail.length > 0) {
        handle.addItems(tail);
      }
      return true;
    }
    case "rename": {
      for (const [oldId, newId] of plan.renames) {
        if (handle.updateItemId(oldId, newId)) {
          continue;
        }
        instance.setItems([...nextItems]);
        return true;
      }
      const renamedPrevious = (previousItems ?? []).map((item) => {
        const hit = plan.renames.find(([oldId]) => oldId === item.id);
        return hit === undefined ? item : { ...item, id: hit[1] };
      });
      if (hasSameCodeViewItemIdOrder(renamedPrevious, nextItems)) {
        if (applyContentUpdates(handle, nextItems, renamedPrevious)) {
          return true;
        }
        instance.setItems([...nextItems]);
        return true;
      }
      instance.setItems([...nextItems]);
      return true;
    }
    case "reconcile":
      instance.setItems([...nextItems]);
      return true;
    default: {
      const exhaustive: never = plan;
      return exhaustive;
    }
  }
}

/**
 * 内容版本是否相对 previous 有变化（estimate→loaded、patch 刷新、折叠等）。
 * 同 id 同 version 视为无正文变更。
 */
export function codeViewItemsContentChanged(
  previousItems: readonly PierDiffCodeViewItem[] | null,
  nextItems: readonly PierDiffCodeViewItem[]
): boolean {
  if (previousItems === null) {
    return nextItems.length > 0;
  }
  if (previousItems.length !== nextItems.length) {
    return true;
  }
  for (let index = 0; index < nextItems.length; index += 1) {
    const next = nextItems[index];
    const previous = previousItems[index];
    if (previous === undefined || next === undefined) {
      return true;
    }
    if (previous.id !== next.id) {
      return true;
    }
    if ((previous.version ?? 0) !== (next.version ?? 0)) {
      return true;
    }
    if (previous === next) {
      continue;
    }
    // 同 version 仍可能换 fileDiff / file 引用（防御）
    if (previous.type === "diff" && next.type === "diff") {
      if (previous.fileDiff !== next.fileDiff) {
        return true;
      }
      continue;
    }
    if (previous.type === "file" && next.type === "file") {
      if (previous.file !== next.file) {
        return true;
      }
      continue;
    }
    return true;
  }
  return false;
}

/**
 * CodeView 拓扑和正文的唯一提交入口。
 *
 * Pierre 在 `setItems/updateItem` 后的同步 render 中，以变更前仍存活的行记录
 * 计算锚点；这里保证一次同步提交，不允许 renderer 再补 raw scrollTop、
 * 延迟纠正或第二次 item 定位。
 *
 * **正文变更必须 flush layout**：仅 updateItem 不 render(true) 时，虚拟列表会
 * 继续画旧 estimate DOM，直到用户滚动才刷新（「滚一下就对了」）。
 */
export function applyCodeViewItemsAnchored(
  handle: PierCodeViewHandle,
  nextItems: readonly PierDiffCodeViewItem[],
  previousItems: readonly PierDiffCodeViewItem[] | null,
  options: {
    readonly focusId?: string;
    readonly flushLayout?: boolean;
  } = {}
): DiffViewAnchoredApplyResult {
  const instanceBefore = handle.getInstance();
  const viewportAnchor = captureCodeViewItemAnchor(instanceBefore);
  const contentChanged = codeViewItemsContentChanged(previousItems, nextItems);
  const accepted = syncCodeViewItems(handle, nextItems, previousItems);
  if (!accepted) {
    return { accepted: false, disposition: "noop" };
  }
  const instance = handle.getInstance();
  // membership 显式 flush 或任意正文版本变化：都要 remeasure 虚拟窗口
  const shouldFlush = options.flushLayout === true || contentChanged;
  if (options.focusId !== undefined) {
    if (handle.getItem(options.focusId) === undefined) {
      if (shouldFlush) {
        flushCodeViewMembershipLayout(instance);
      }
      return { accepted: false, disposition: "noop" };
    }
    handle.scrollTo({
      align: "start",
      behavior: "instant",
      id: options.focusId,
      type: "item",
    });
    if (shouldFlush) {
      flushCodeViewMembershipLayout(instance);
    }
    return { accepted: true, disposition: "focused" };
  }
  if (
    viewportAnchor !== null &&
    handle.getItem(viewportAnchor.id) === undefined
  ) {
    const nextId = resolveAnchoredItemId(
      viewportAnchor.id,
      previousItems ?? [],
      nextItems
    );
    if (nextId !== null) {
      scrollToResolvedAnchor(
        handle,
        viewportAnchor,
        nextId,
        previousItems ?? [],
        nextItems
      );
    }
  }
  if (shouldFlush) {
    flushCodeViewMembershipLayout(instance);
  }
  return {
    accepted: true,
    disposition: nextItems.length === 0 ? "empty" : "preserved",
  };
}

function flushCodeViewMembershipLayout(
  instance: ReturnType<PierCodeViewHandle["getInstance"]>
): void {
  // Pierre 1.2.x：render(true) 内部 flushSync。membership apply 常在
  // useLayoutEffect 中调用；React 19 禁止在 lifecycle 里再 flushSync。
  // 命令式 setItems 仍同步；measure 放到 microtask，同一事件循环、commit 之后。
  if (instance == null) {
    return;
  }
  const target = instance;
  queueMicrotask(() => {
    try {
      for (let pass = 0; pass < MEMBERSHIP_LAYOUT_PASSES; pass += 1) {
        target.render(true);
      }
    } catch (error) {
      // unmount / 测试替身不完整时实例可能已拆；其它异常在 dev 可见
      if (import.meta.env.DEV) {
        console.warn(
          "[PierDiffView] deferred membership layout flush failed",
          error
        );
      }
    }
  });
}

/**
 * 锚点 id 消失时先识别同路径 1:1 身份迁移，再按旧拓扑选择后继/前驱。
 * 该规则与成员提交处于同一模块，renderer 不得自行猜测新的落点。
 */
export function resolveAnchoredItemId(
  anchorId: string,
  previousItems: readonly PierDiffCodeViewItem[],
  nextItems: readonly PierDiffCodeViewItem[]
): string | null {
  const nextIds = new Set(nextItems.map((item) => item.id));
  if (nextIds.has(anchorId)) {
    return anchorId;
  }
  const renamed = planPathAlignedIdRenames(previousItems, nextItems)?.find(
    ([oldId]) => oldId === anchorId
  )?.[1];
  if (renamed !== undefined && nextIds.has(renamed)) {
    return renamed;
  }
  return deletedAnchorFallbackId(
    anchorId,
    previousItems.map((item) => item.id),
    nextIds
  );
}

function captureCodeViewItemAnchor(
  instance: ReturnType<PierCodeViewHandle["getInstance"]>
): CapturedCodeViewAnchor | null {
  if (instance === undefined) {
    return null;
  }
  const rendered = instance.getRenderedItems();
  if (rendered.length === 0) {
    return null;
  }
  const scrollTop = instance.getScrollTop();
  const stickyHeaderOffset = codeViewHeaderHeight(instance);
  for (const item of rendered) {
    // `getRenderedItems()` may briefly retain a recycled virtualized instance.
    // Resolve geometry through the stable item id so anchor capture cannot race
    // Pierre's instance pool.
    const top = instance.getTopForItem(item.id);
    if (top === undefined) {
      continue;
    }
    if (top >= scrollTop) {
      return {
        id: item.id,
        type: "item",
        viewportOffset: top - scrollTop,
      };
    }
    const line = item.instance.getNumericScrollAnchor(
      scrollTop - top + stickyHeaderOffset
    );
    if (line !== undefined) {
      return {
        id: item.id,
        lineNumber: line.lineNumber,
        ...(line.side === undefined ? {} : { side: line.side }),
        type: "line",
        viewportOffset: top + line.top - scrollTop - stickyHeaderOffset,
      };
    }
  }
  return null;
}

function codeViewHeaderHeight(instance: unknown): number {
  if (!instance || typeof instance !== "object") {
    return DIFF_HEADER_HEIGHT_PX;
  }
  const metrics = (
    instance as {
      readonly itemMetricsCache?: { readonly diffHeaderHeight?: unknown };
    }
  ).itemMetricsCache;
  const height = metrics?.diffHeaderHeight;
  return typeof height === "number" && Number.isFinite(height) && height > 0
    ? height
    : DIFF_HEADER_HEIGHT_PX;
}

function scrollToResolvedAnchor(
  handle: PierCodeViewHandle,
  anchor: CapturedCodeViewAnchor,
  nextId: string,
  previousItems: readonly PierDiffCodeViewItem[],
  nextItems: readonly PierDiffCodeViewItem[]
): void {
  const isIdentityMigration =
    anchor.id === nextId ||
    planPathAlignedIdRenames(previousItems, nextItems)?.some(
      ([oldId, newId]) => oldId === anchor.id && newId === nextId
    ) === true;
  if (isIdentityMigration && anchor.type === "line") {
    handle.scrollTo({
      align: "start",
      behavior: "instant",
      id: nextId,
      lineNumber: anchor.lineNumber,
      offset: anchor.viewportOffset,
      ...(anchor.side === undefined ? {} : { side: anchor.side }),
      type: "line",
    });
    return;
  }
  handle.scrollTo({
    align: "start",
    behavior: "instant",
    id: nextId,
    // Never transfer a deleted file's internal scroll depth to a neighboring
    // file. A surviving/renamed item may retain its item-level viewport inset.
    offset: isIdentityMigration ? anchor.viewportOffset : 0,
    type: "item",
  });
}

export function deletedAnchorFallbackId(
  anchorId: string,
  previousIds: readonly string[],
  nextIds: ReadonlySet<string>
): string | null {
  const anchorIndex = previousIds.indexOf(anchorId);
  if (anchorIndex < 0) {
    return null;
  }
  for (let index = anchorIndex + 1; index < previousIds.length; index += 1) {
    const id = previousIds[index];
    if (id !== undefined && nextIds.has(id)) {
      return id;
    }
  }
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const id = previousIds[index];
    if (id !== undefined && nextIds.has(id)) {
      return id;
    }
  }
  return null;
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

function applyContentUpdates(
  handle: PierCodeViewHandle,
  nextItems: readonly PierDiffCodeViewItem[],
  previousItems: readonly PierDiffCodeViewItem[]
): boolean {
  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  // estimate→loaded：优先 per-id updateItem；失败再整表 setItems（避免每文件
  // hydrate 都 setItems(全账本) 打爆 Pierre）。
  let allAccepted = true;
  let estimateToLoadedCount = 0;
  for (const item of nextItems) {
    const previous = previousById.get(item.id);
    if (previous === item) {
      continue;
    }
    if (isEstimateCodeViewItem(previous) && !isEstimateCodeViewItem(item)) {
      estimateToLoadedCount += 1;
    }
    if (!acceptDiffViewItem(handle, item)) {
      allAccepted = false;
    }
  }
  if (!allAccepted) {
    handle.getInstance()?.setItems([...nextItems]);
    return true;
  }
  // 多文件同批 estimate→loaded 时，单次 setItems 比 N 次 updateItem 更稳
  if (estimateToLoadedCount >= 4) {
    handle.getInstance()?.setItems([...nextItems]);
    return true;
  }
  return true;
}
