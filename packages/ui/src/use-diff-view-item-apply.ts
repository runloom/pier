import type { CodeViewHandle } from "@pierre/diffs/react";
import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PierHunkAnnotationMetadata } from "./diff-view-hunk-actions.tsx";
import { syncCodeViewItems } from "./diff-view-item-sync.ts";
import type {
  ParsedItemCacheEntry,
  PierDiffCodeViewItem,
  PierDiffViewItem,
} from "./diff-view-items.ts";
import type { DiffViewRenderItemIdentity } from "./use-diff-view-handle.ts";

const MAX_ITEM_APPLY_ATTEMPTS = 3;

interface ItemApplyRetryState {
  attempts: number;
  readonly items: readonly PierDiffCodeViewItem[];
  lastRevision: number;
}

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
 * 瞬时拒绝下一帧重试；三次仍失败才上报。不因 id 集合变化 remount。
 *
 * membership 拓扑变后：禁止外层 item 级 scrollTo（会清 Pierre 行锚并闪一下）。
 * 改为 instance.render(true) 在 paint 前同步 recompute + 行级 anchoring。
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
  const retryRef = useRef<ItemApplyRetryState | null>(null);
  const retryFrameRef = useRef<number | null>(null);
  const [revision, setRevision] = useState(0);

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

    const accepted = syncCodeViewItems(handle, codeViewItems, previousOrdered);
    if (!accepted) {
      const retry = retryRef.current;
      if (retry?.items === codeViewItems) {
        if (retry.lastRevision !== revision) {
          retry.lastRevision = revision;
          retry.attempts += 1;
        }
      } else {
        retryRef.current = {
          attempts: 1,
          items: codeViewItems,
          lastRevision: revision,
        };
      }
      if ((retryRef.current?.attempts ?? 0) >= MAX_ITEM_APPLY_ATTEMPTS) {
        onError(new Error("Pierre did not accept the current diff items."));
        return;
      }
      if (retryFrameRef.current === null) {
        retryFrameRef.current = requestAnimationFrame(() => {
          retryFrameRef.current = null;
          setRevision((current) => current + 1);
        });
      }
      return;
    }

    retryRef.current = null;
    if (retryFrameRef.current !== null) {
      cancelAnimationFrame(retryFrameRef.current);
      retryFrameRef.current = null;
    }

    // membership 拓扑变：setItems 默认 queueRender(rAF)，paint 前未 recompute 会闪。
    // render(true) 同步 layout + Pierre 行级 scroll anchoring；禁止外层 scrollTo。
    if (shouldFlushLayout) {
      const instance = handle.getInstance();
      if (
        instance &&
        typeof (instance as { render?: (immediate?: boolean) => void })
          .render === "function"
      ) {
        (instance as { render: (immediate?: boolean) => void }).render(true);
      }
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
    revision,
    scheduleRenderWindowReport,
    getSuppressMembershipScrollRestore,
    suppressMembershipScrollRestore,
  ]);

  useEffect(
    () => () => {
      if (retryFrameRef.current !== null) {
        cancelAnimationFrame(retryFrameRef.current);
      }
    },
    []
  );
}
