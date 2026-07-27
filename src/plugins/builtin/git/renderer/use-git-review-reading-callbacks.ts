import type { RefObject } from "react";
import { useCallback } from "react";
import type { PendingReviewAnchor } from "./git-review-document-projection.ts";
import { shouldRestoreReadingAnchorExternally } from "./git-review-reading-anchor.ts";
import type {
  createGitReviewReadingSession,
  ReviewReadingMode,
} from "./git-review-reading-session.ts";

type ReviewReadingSession = ReturnType<typeof createGitReviewReadingSession>;

export function useGitReviewReadingCallbacks(options: {
  readonly itemIdsRef: RefObject<readonly string[]>;
  readonly pendingAnchorRef: RefObject<PendingReviewAnchor | null>;
  readonly readingSessionRef: RefObject<ReviewReadingSession>;
}): {
  readonly beginReadingNavigating: (entryKey: string) => void;
  readonly beginReadingRefresh: () => void;
  readonly endReadingNavigating: () => void;
  readonly endReadingRefresh: () => void;
  readonly getReadingMode: () => ReviewReadingMode;
  readonly noteUserScrollReading: () => void;
  readonly onNavigationSettled: () => void;
  readonly onNavigationStarted: (entryKey: string) => void;
  readonly syncReadingPinnedPrefix: (options: {
    readonly candidates: ReadonlySet<string>;
    readonly entryKeysInOrder: readonly string[];
    readonly selectedEntryKey: string | null;
    readonly viewportEntryKeys: readonly string[];
  }) => readonly string[];
} {
  const { itemIdsRef, pendingAnchorRef, readingSessionRef } = options;

  const onNavigationStarted = useCallback(
    (entryKey: string) => {
      readingSessionRef.current.beginNavigating(entryKey);
    },
    [readingSessionRef]
  );

  const onNavigationSettled = useCallback(() => {
    readingSessionRef.current.endNavigating();
  }, [readingSessionRef]);

  const beginReadingNavigating = useCallback(
    (entryKey: string) => {
      readingSessionRef.current.beginNavigating(entryKey);
    },
    [readingSessionRef]
  );

  const beginReadingRefresh = useCallback(() => {
    readingSessionRef.current.beginRefreshing();
  }, [readingSessionRef]);

  const endReadingNavigating = useCallback(() => {
    readingSessionRef.current.endNavigating();
  }, [readingSessionRef]);

  const endReadingRefresh = useCallback(() => {
    readingSessionRef.current.endRefreshing();
    // 同 id 存活：外层不 restore，可清 pending（Pierre 行锚）。
    // identity 丢失：禁止在 loader 同步路径 restore——此时 DiffView 可能尚未
    // setItems，neighborhood 会对旧拓扑误成功并清 pending（R4 半/整 stage 洞）。
    // 真正 restore 只在 layout tryPendingAnchor（子 DiffView apply 之后）。
    const pending = pendingAnchorRef.current;
    if (!pending) {
      return;
    }
    if (!shouldRestoreReadingAnchorExternally(pending, itemIdsRef.current)) {
      pendingAnchorRef.current = null;
    }
  }, [itemIdsRef, pendingAnchorRef, readingSessionRef]);

  const getReadingMode = useCallback(
    () => readingSessionRef.current.getMode(),
    [readingSessionRef]
  );

  const noteUserScrollReading = useCallback(() => {
    readingSessionRef.current.noteUserScroll();
  }, [readingSessionRef]);

  const syncReadingPinnedPrefix = useCallback(
    (options: {
      readonly candidates: ReadonlySet<string>;
      readonly entryKeysInOrder: readonly string[];
      readonly selectedEntryKey: string | null;
      readonly viewportEntryKeys: readonly string[];
    }) => readingSessionRef.current.syncPinnedPrefix(options),
    [readingSessionRef]
  );

  return {
    beginReadingNavigating,
    beginReadingRefresh,
    endReadingNavigating,
    endReadingRefresh,
    getReadingMode,
    noteUserScrollReading,
    onNavigationSettled,
    onNavigationStarted,
    syncReadingPinnedPrefix,
  };
}
