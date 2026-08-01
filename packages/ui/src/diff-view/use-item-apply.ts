import type { CodeViewHandle } from "@pierre/diffs/react";
import { type RefObject, useLayoutEffect } from "react";
import type { PierHunkAnnotationMetadata } from "./hunk-actions.tsx";
import { applyCodeViewItemsAnchored } from "./item-sync.ts";
import type {
  ParsedItemCacheEntry,
  PierDiffCodeViewItem,
  PierDiffViewItem,
} from "./items.ts";
import type { DiffViewRenderItemIdentity } from "./use-handle.ts";

/**
 * membership 拓扑变更后是否应在 apply 后做即时 layout flush（`render(true)`）。
 * pendingNav 时禁止：与 scrollTo(target) 双意图冲突。
 * 禁止用此闸门再写 raw scrollTop。
 */
export function shouldFlushMembershipLayout(options: {
  readonly getSuppressMembershipScrollRestore?: () => boolean;
  readonly membershipChanged: boolean;
  readonly suppressMembershipScrollRestore?: boolean;
}): boolean {
  if (!options.membershipChanged) {
    return false;
  }
  if (options.suppressMembershipScrollRestore === true) {
    return false;
  }
  if (options.getSuppressMembershipScrollRestore?.() === true) {
    return false;
  }
  return true;
}

/** @deprecated Use {@link shouldFlushMembershipLayout}. */
export const shouldRestoreMembershipScrollTop = shouldFlushMembershipLayout;

/**
 * 成员与正文变更在同一 CodeView 实例内同步（addItems / updateItem / setItems）。
 * Pierre 拒绝时立即上报并保留旧缓存，等待下一次权威输入重新提交；
 * 禁止通过下一帧或定时器重试。不因 id 集合变化 remount。
 *
 * membership 拓扑变后：禁止外层 item 级 scrollTo（会清 Pierre 行锚并闪一下）。
 * setItems 仍在 layout 同步；instance.render(true) 经 microtask 延后（React 19
 * 禁止 layout 内 flushSync），见 item-sync.flushCodeViewMembershipLayout。
 */
export function useDiffViewItemApply({
  appliedItemsRef,
  bumpItemEpoch,
  codeViewItems,
  codeViewKey,
  codeViewRef,
  inputs,
  onError,
  parsedCache,
  parsedInputRef,
  parsedItemIndexesRef,
  parsedItemListRef,
  parsedItemsRef,
  renderItemIdentitiesRef,
  scheduleRenderWindowReport,
  firstLayoutItemIdsRef,
  getSuppressMembershipScrollRestore,
  suppressMembershipScrollRestore = false,
}: {
  readonly appliedItemsRef: RefObject<{
    readonly key: string;
    readonly items: Map<string, PierDiffCodeViewItem>;
  } | null>;
  readonly bumpItemEpoch: () => void;
  readonly codeViewItems: PierDiffCodeViewItem[];
  readonly codeViewKey: string;
  readonly codeViewRef: RefObject<CodeViewHandle<PierHunkAnnotationMetadata> | null>;
  readonly firstLayoutItemIdsRef?: RefObject<Set<string>>;
  readonly getSuppressMembershipScrollRestore?: () => boolean;
  readonly inputs: readonly PierDiffViewItem[];
  readonly onError: (error: Error) => void;
  readonly parsedCache: Map<string, ParsedItemCacheEntry>;
  readonly parsedInputRef: RefObject<readonly PierDiffViewItem[] | null>;
  readonly parsedItemIndexesRef: RefObject<Map<string, number>>;
  readonly parsedItemListRef: RefObject<PierDiffCodeViewItem[]>;
  readonly parsedItemsRef: RefObject<Map<string, ParsedItemCacheEntry>>;
  readonly renderItemIdentitiesRef: RefObject<
    Map<string, DiffViewRenderItemIdentity>
  >;
  readonly scheduleRenderWindowReport: () => void;
  /** 树导航 pending 时禁止 membership 后即时 layout flush。 */
  readonly suppressMembershipScrollRestore?: boolean;
}): void {
  useLayoutEffect(() => {
    const handle = codeViewRef.current;
    if (!handle) {
      return;
    }
    const applied = appliedItemsRef.current;
    if (
      applied?.key === codeViewKey &&
      applied.items.size === codeViewItems.length &&
      codeViewItems.every((item) => applied.items.get(item.id) === item)
    ) {
      return;
    }

    // 仅同 codeViewKey（布局实例）下的上次成功列表可作 previous；
    // 换 key 后实例已 seed initialItems，previous=null 走匹配/setItems。
    const previousOrdered =
      applied?.key === codeViewKey ? parsedItemListRef.current : null;

    const membershipChanged =
      previousOrdered !== null &&
      (previousOrdered.length !== codeViewItems.length ||
        previousOrdered.some(
          (item, index) => item.id !== codeViewItems[index]?.id
        ));
    const previousIdSet =
      previousOrdered === null
        ? null
        : new Set(previousOrdered.map((item) => item.id));

    const shouldFlushLayout = shouldFlushMembershipLayout({
      membershipChanged,
      suppressMembershipScrollRestore,
      ...(getSuppressMembershipScrollRestore === undefined
        ? {}
        : { getSuppressMembershipScrollRestore }),
    });

    const applyResult = applyCodeViewItemsAnchored(
      handle,
      codeViewItems,
      previousOrdered,
      { flushLayout: shouldFlushLayout }
    );
    if (!applyResult.accepted) {
      onError(new Error("Pierre did not accept the current diff items."));
      return;
    }

    // 记录本次 membership apply 新建成员，供 scrollToItem 选 instant。
    // 初次 seed（previousOrdered=null）不算导航 firstLayout，避免已在场成员被误标 instant。
    if (firstLayoutItemIdsRef) {
      firstLayoutItemIdsRef.current =
        previousIdSet === null
          ? new Set()
          : new Set(
              codeViewItems
                .filter((item) => !previousIdSet.has(item.id))
                .map((item) => item.id)
            );
    }
    parsedItemsRef.current = parsedCache;
    parsedItemListRef.current = [...codeViewItems];
    parsedInputRef.current = inputs;
    parsedItemIndexesRef.current = new Map(
      codeViewItems.map((item, index) => [item.id, index])
    );
    renderItemIdentitiesRef.current = new Map(
      codeViewItems.flatMap((item) => {
        const cacheKey = parsedCache.get(item.id)?.cacheKey;
        return cacheKey === undefined
          ? []
          : [[item.id, { cacheKey, version: item.version ?? 0 }] as const];
      })
    );
    appliedItemsRef.current = {
      items: new Map(codeViewItems.map((item) => [item.id, item])),
      key: codeViewKey,
    };
    // 仅当列表引用相对上次 apply 变化时 bump，避免 apply→epoch→apply 环。
    if (previousOrdered !== codeViewItems) {
      bumpItemEpoch();
    }
    scheduleRenderWindowReport();
  }, [
    appliedItemsRef,
    bumpItemEpoch,
    codeViewItems,
    codeViewKey,
    codeViewRef,
    firstLayoutItemIdsRef,
    inputs,
    onError,
    parsedCache,
    parsedInputRef,
    parsedItemIndexesRef,
    parsedItemListRef,
    parsedItemsRef,
    renderItemIdentitiesRef,
    scheduleRenderWindowReport,
    getSuppressMembershipScrollRestore,
    suppressMembershipScrollRestore,
  ]);
}
