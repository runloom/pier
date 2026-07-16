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

const MAX_REPLAY_ATTEMPTS = 3;

interface PendingReplay {
  attempts: number;
  readonly generation: number;
  readonly handle: PierDiffViewHandle;
  readonly ids: Set<string> | null;
  readonly revision: number;
}

/**
 * 稀疏正文以 latest-map 为唯一回放源。Pierre 瞬时拒绝时，下一帧读取最新值重试，
 * 避免捕获旧 patch；换代、换 handle 和卸载都会使迟到重试失效。
 */
export function useGitReviewItemReplay({
  committedProjectionGenerationRef,
  diffHandleRef,
  documentGenerationRef,
  hasPendingNavigation,
  latestItemUpdatesRef,
}: {
  readonly committedProjectionGenerationRef: RefObject<number>;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly hasPendingNavigation: () => boolean;
  readonly latestItemUpdatesRef: RefObject<Map<string, PierDiffViewItem>>;
}): {
  readonly applyItemUpdates: (
    handle: PierDiffViewHandle,
    generation: number,
    items: readonly PierDiffViewItem[]
  ) => boolean;
  readonly clearLatestItemUpdates: () => void;
  readonly replayFailure: Error | null;
  readonly recordLatestItemUpdates: (
    items: readonly PierDiffViewItem[]
  ) => void;
  readonly replayLatestItemUpdates: (
    handle: PierDiffViewHandle,
    generation: number
  ) => boolean;
  readonly retryLatestItemUpdates: () => void;
} {
  const pendingRef = useRef<PendingReplay | null>(null);
  const frameRef = useRef<number | null>(null);
  const revisionRef = useRef(0);
  const [replayFailure, setReplayFailure] = useState<Error | null>(null);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const clearLatestItemUpdates = useCallback(() => {
    cancelFrame();
    latestItemUpdatesRef.current.clear();
    pendingRef.current = null;
    revisionRef.current += 1;
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
      revisionRef.current += 1;
    },
    [latestItemUpdatesRef]
  );

  const applyUpdates = useCallback(
    function apply(
      handle: PierDiffViewHandle,
      generation: number,
      requestedIds: Set<string> | null
    ): boolean {
      if (
        handle !== diffHandleRef.current ||
        generation !== documentGenerationRef.current ||
        generation !== committedProjectionGenerationRef.current
      ) {
        return false;
      }
      const revision = revisionRef.current;
      const pending = pendingRef.current;
      let ids = requestedIds;
      let previousAttempts = 0;
      if (pending?.handle === handle && pending.generation === generation) {
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
        if (pending.revision === revision) {
          previousAttempts = pending.attempts;
          if (pending.attempts >= MAX_REPLAY_ATTEMPTS) {
            return false;
          }
        }
        if (frameRef.current !== null) {
          pendingRef.current = {
            attempts: previousAttempts,
            generation,
            handle,
            ids,
            revision,
          };
          return false;
        }
      }
      const items =
        ids === null
          ? [...latestItemUpdatesRef.current.values()]
          : [...ids].flatMap((id) => {
              const item = latestItemUpdatesRef.current.get(id);
              return item ? [item] : [];
            });
      if (items.length === 0) {
        pendingRef.current = null;
        cancelFrame();
        return true;
      }
      const attempts = previousAttempts + 1;
      if (
        handle.updateItems(items, {
          preserveAnchor: !hasPendingNavigation(),
        })
      ) {
        pendingRef.current = null;
        cancelFrame();
        setReplayFailure(null);
        return true;
      }
      pendingRef.current = {
        attempts,
        generation,
        handle,
        ids,
        revision,
      };
      if (attempts >= MAX_REPLAY_ATTEMPTS) {
        setReplayFailure(
          new Error("Pierre did not accept the latest review document.")
        );
        return false;
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const current = pendingRef.current;
        if (current?.handle === handle && current.generation === generation) {
          apply(handle, generation, current.ids);
        }
      });
      return false;
    },
    [
      cancelFrame,
      committedProjectionGenerationRef,
      diffHandleRef,
      documentGenerationRef,
      hasPendingNavigation,
      latestItemUpdatesRef,
    ]
  );

  const applyItemUpdates = useCallback(
    (
      handle: PierDiffViewHandle,
      generation: number,
      items: readonly PierDiffViewItem[]
    ) =>
      applyUpdates(handle, generation, new Set(items.map((item) => item.id))),
    [applyUpdates]
  );
  const replayLatestItemUpdates = useCallback(
    (handle: PierDiffViewHandle, generation: number) =>
      applyUpdates(handle, generation, null),
    [applyUpdates]
  );

  const retryLatestItemUpdates = useCallback(() => {
    const ids = pendingRef.current?.ids ?? null;
    pendingRef.current = null;
    setReplayFailure(null);
    const handle = diffHandleRef.current;
    if (handle) {
      applyUpdates(handle, documentGenerationRef.current, ids);
    }
  }, [applyUpdates, diffHandleRef, documentGenerationRef]);

  useEffect(() => cancelFrame, [cancelFrame]);

  return {
    applyItemUpdates,
    clearLatestItemUpdates,
    replayFailure,
    recordLatestItemUpdates,
    replayLatestItemUpdates,
    retryLatestItemUpdates,
  };
}
