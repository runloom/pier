import type { CodeViewHandle, CodeViewItem } from "@pierre/diffs/react";
import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  ParsedItemCacheEntry,
  PierDiffViewItem,
} from "./diff-view-items.ts";
import {
  acceptDiffViewItem,
  type DiffViewRenderItemIdentity,
} from "./use-diff-view-handle.ts";

const MAX_ITEM_APPLY_ATTEMPTS = 3;

interface ItemApplyRetryState {
  attempts: number;
  readonly items: readonly CodeViewItem[];
  lastRevision: number;
}

/**
 * 同一拓扑的正文更新必须先被 Pierre 接受，再提交适配层缓存。
 * `updateItem(false)` 视为瞬时拒绝，下一帧自动重试；三次仍失败才上报。
 */
export function useDiffViewItemApply({
  appliedItemsRef,
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
}: {
  readonly appliedItemsRef: RefObject<{
    readonly key: string;
    readonly items: Map<string, CodeViewItem>;
  } | null>;
  readonly codeViewItems: CodeViewItem[];
  readonly codeViewKey: string;
  readonly codeViewRef: RefObject<CodeViewHandle<undefined> | null>;
  readonly inputs: readonly PierDiffViewItem[];
  readonly onError: (error: Error) => void;
  readonly parsedCache: Map<string, ParsedItemCacheEntry>;
  readonly parsedInputRef: RefObject<readonly PierDiffViewItem[] | null>;
  readonly parsedItemIndexesRef: RefObject<Map<string, number>>;
  readonly parsedItemListRef: RefObject<CodeViewItem[]>;
  readonly parsedItemsRef: RefObject<Map<string, ParsedItemCacheEntry>>;
  readonly renderItemIdentitiesRef: RefObject<
    Map<string, DiffViewRenderItemIdentity>
  >;
  readonly scheduleRenderWindowReport: () => void;
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
    let accepted = true;
    for (const item of codeViewItems) {
      if (applied?.key === codeViewKey && applied.items.get(item.id) === item) {
        continue;
      }
      if (!acceptDiffViewItem(handle, item)) {
        accepted = false;
      }
    }
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
    parsedItemsRef.current = parsedCache;
    parsedItemListRef.current = codeViewItems;
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
    scheduleRenderWindowReport();
  }, [
    appliedItemsRef,
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
    revision,
    scheduleRenderWindowReport,
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
