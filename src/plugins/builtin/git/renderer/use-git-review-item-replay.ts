import type {
  PierDiffViewHandle,
  PierDiffViewItem,
} from "@pier/ui/diff-view.tsx";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface PendingReplay {
  readonly allowedIds: ReadonlySet<string> | null;
  readonly generation: number;
  readonly handle: PierDiffViewHandle;
  readonly ids: Set<string> | null;
  readonly preserveAnchor: boolean;
}

/**
 * 稀疏正文以 latest-map 为唯一回放源。Pierre 拒绝时保留最新快照供显式重试；
 * 不跨帧自动补写，避免一次暂存产生两次可见正文提交。
 */
export function useGitReviewItemReplay({
  committedProjectionGenerationRef,
  diffHandleRef,
  documentGenerationRef,
  enabledRef,
  latestItemUpdatesRef,
}: {
  readonly committedProjectionGenerationRef: RefObject<number>;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly documentGenerationRef: RefObject<number>;
  /** 非活动阅读面保留 latest-map，但不触碰隐藏的 Pierre DOM。 */
  readonly enabledRef: RefObject<boolean>;
  readonly latestItemUpdatesRef: RefObject<Map<string, PierDiffViewItem>>;
}): {
  readonly applyItemUpdates: (
    handle: PierDiffViewHandle,
    generation: number,
    items: readonly PierDiffViewItem[],
    options?: {
      readonly flush?: boolean;
      readonly preserveAnchor?: boolean;
    }
  ) => boolean;
  /** settle 前冲刷挂起的 coalesce rAF，避免 restore 后再被晚到 updateItems 推视口 */
  readonly flushPendingItemUpdates: (
    handle: PierDiffViewHandle,
    generation: number
  ) => boolean;
  readonly clearLatestItemUpdates: () => void;
  readonly replayFailure: Error | null;
  readonly recordLatestItemUpdates: (
    items: readonly PierDiffViewItem[]
  ) => void;
  readonly replayLatestItemUpdates: (
    handle: PierDiffViewHandle,
    generation: number,
    allowedIds?: readonly string[]
  ) => boolean;
  readonly retryLatestItemUpdates: () => void;
} {
  const pendingRef = useRef<PendingReplay | null>(null);
  /** 同帧多 settle 合并：ids + generation + handle */
  const coalesceRef = useRef<{
    readonly generation: number;
    readonly handle: PierDiffViewHandle;
    readonly ids: Set<string>;
    frameId: number | null;
    preserveAnchor: boolean;
  } | null>(null);
  const [replayFailure, setReplayFailure] = useState<Error | null>(null);

  const cancelFrame = useCallback(() => {
    const coalesce = coalesceRef.current;
    if (coalesce?.frameId != null) {
      cancelAnimationFrame(coalesce.frameId);
    }
    coalesceRef.current = null;
  }, []);

  const clearLatestItemUpdates = useCallback(() => {
    cancelFrame();
    latestItemUpdatesRef.current.clear();
    pendingRef.current = null;
    setReplayFailure(null);
  }, [cancelFrame, latestItemUpdatesRef]);

  const recordLatestItemUpdates = useCallback(
    (items: readonly PierDiffViewItem[]) => {
      if (items.length === 0) {
        return;
      }
      for (const item of items) {
        latestItemUpdatesRef.current.set(item.id, item);
      }
    },
    [latestItemUpdatesRef]
  );

  const applyUpdates = useCallback(
    function apply(
      handle: PierDiffViewHandle,
      generation: number,
      requestedIds: Set<string> | null,
      allowedIds?: ReadonlySet<string> | null,
      preserveAnchor = false
    ): boolean {
      if (!enabledRef.current) {
        pendingRef.current = null;
        cancelFrame();
        return true;
      }
      if (
        handle !== diffHandleRef.current ||
        generation !== documentGenerationRef.current ||
        generation !== committedProjectionGenerationRef.current
      ) {
        return false;
      }
      if (allowedIds) {
        for (const id of [...latestItemUpdatesRef.current.keys()]) {
          if (!allowedIds.has(id)) {
            latestItemUpdatesRef.current.delete(id);
          }
        }
      }
      const pending = pendingRef.current;
      let ids = requestedIds;
      let shouldPreserveAnchor = preserveAnchor;
      if (pending?.handle === handle && pending.generation === generation) {
        shouldPreserveAnchor ||= pending.preserveAnchor;
        if (pending.ids === null || requestedIds === null) {
          ids = null;
        } else {
          if (pending.ids !== requestedIds) {
            for (const id of requestedIds) {
              pending.ids.add(id);
            }
          }
          ids = pending.ids;
        }
      }
      const candidateIds =
        ids === null ? [...latestItemUpdatesRef.current.keys()] : [...ids];
      const items = candidateIds.flatMap((id) => {
        if (allowedIds && !allowedIds.has(id)) {
          return [];
        }
        const item = latestItemUpdatesRef.current.get(id);
        return item ? [item] : [];
      });
      if (items.length === 0) {
        pendingRef.current = null;
        cancelFrame();
        return true;
      }
      // preserveAnchor:false → Pierre CodeView 内置行级 scroll anchoring。
      if (handle.updateItems(items, { preserveAnchor: shouldPreserveAnchor })) {
        pendingRef.current = null;
        cancelFrame();
        setReplayFailure(null);
        return true;
      }
      pendingRef.current = {
        allowedIds: allowedIds ?? null,
        generation,
        handle,
        ids,
        preserveAnchor,
      };
      setReplayFailure(
        new Error("Pierre did not accept the latest review document.")
      );
      return false;
    },
    [
      cancelFrame,
      committedProjectionGenerationRef,
      diffHandleRef,
      documentGenerationRef,
      enabledRef,
      latestItemUpdatesRef,
    ]
  );

  /**
   * 冷启动 / 并发 settle：同帧内多次 apply 合并为一次 updateItems，
   * 让 Pierre 只做一轮 layout + 行级 anchoring，减少「一文件一抖」。
   * settle 路径传 `flush: true`：立刻 updateItems，再跑 endReadingRefresh，
   * 避免 rAF 正文晚于外层 restore 二次推视口。
   */
  const applyItemUpdates = useCallback(
    (
      handle: PierDiffViewHandle,
      generation: number,
      items: readonly PierDiffViewItem[],
      options?: {
        readonly flush?: boolean;
        readonly preserveAnchor?: boolean;
      }
    ): boolean => {
      if (items.length === 0) {
        return true;
      }
      const ids = items.map((item) => item.id);
      if (options?.flush === true) {
        // 取消挂起 coalesce，同步落正文后再由调用方 settle restore
        const existing = coalesceRef.current;
        if (existing?.frameId != null) {
          cancelAnimationFrame(existing.frameId);
        }
        if (existing && existing.generation === generation) {
          for (const id of ids) {
            existing.ids.add(id);
          }
          const merged = existing.ids;
          const preserveAnchor =
            existing.preserveAnchor || options.preserveAnchor === true;
          coalesceRef.current = null;
          return applyUpdates(handle, generation, merged, null, preserveAnchor);
        }
        coalesceRef.current = null;
        return applyUpdates(
          handle,
          generation,
          new Set(ids),
          null,
          options.preserveAnchor === true
        );
      }
      const existing = coalesceRef.current;
      if (
        existing &&
        existing.handle === handle &&
        existing.generation === generation
      ) {
        existing.preserveAnchor ||= options?.preserveAnchor === true;
        for (const id of ids) {
          existing.ids.add(id);
        }
        return true;
      }
      if (existing?.frameId != null) {
        cancelAnimationFrame(existing.frameId);
      }
      const bucket = {
        frameId: null as number | null,
        generation,
        handle,
        ids: new Set(ids),
        preserveAnchor: options?.preserveAnchor === true,
      };
      coalesceRef.current = bucket;
      bucket.frameId = requestAnimationFrame(() => {
        const current = coalesceRef.current;
        coalesceRef.current = null;
        if (
          !(
            current &&
            current.handle === handle &&
            current.generation === generation
          )
        ) {
          return;
        }
        applyUpdates(
          handle,
          generation,
          current.ids,
          null,
          current.preserveAnchor
        );
      });
      return true;
    },
    [applyUpdates]
  );

  const flushPendingItemUpdates = useCallback(
    (handle: PierDiffViewHandle, generation: number): boolean => {
      const existing = coalesceRef.current;
      if (
        !(
          existing &&
          existing.handle === handle &&
          existing.generation === generation
        )
      ) {
        return true;
      }
      if (existing.frameId != null) {
        cancelAnimationFrame(existing.frameId);
      }
      const ids = existing.ids;
      const { preserveAnchor } = existing;
      coalesceRef.current = null;
      return applyUpdates(handle, generation, ids, null, preserveAnchor);
    },
    [applyUpdates]
  );

  const replayLatestItemUpdates = useCallback(
    (
      handle: PierDiffViewHandle,
      generation: number,
      allowedIds?: readonly string[]
    ) =>
      applyUpdates(
        handle,
        generation,
        null,
        allowedIds ? new Set(allowedIds) : null
      ),
    [applyUpdates]
  );

  const retryLatestItemUpdates = useCallback(() => {
    const pending = pendingRef.current;
    const ids = pending?.ids ?? null;
    const allowedIds = pending?.allowedIds ?? null;
    const preserveAnchor = pending?.preserveAnchor ?? false;
    pendingRef.current = null;
    setReplayFailure(null);
    const handle = diffHandleRef.current;
    if (handle) {
      applyUpdates(
        handle,
        documentGenerationRef.current,
        ids,
        allowedIds,
        preserveAnchor
      );
    }
  }, [applyUpdates, diffHandleRef, documentGenerationRef]);

  useEffect(() => cancelFrame, [cancelFrame]);

  return {
    applyItemUpdates,
    clearLatestItemUpdates,
    flushPendingItemUpdates,
    replayFailure,
    recordLatestItemUpdates,
    replayLatestItemUpdates,
    retryLatestItemUpdates,
  };
}
