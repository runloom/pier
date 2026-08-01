import type { RefObject } from "react";
import { useCallback } from "react";
import type {
  createGitReviewReadingSession,
  ReviewReadingMode,
} from "../review/reading-session.ts";

type ReviewReadingSession = ReturnType<typeof createGitReviewReadingSession>;

export function useGitReviewReadingCallbacks(options: {
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
  const { readingSessionRef } = options;

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
  }, [readingSessionRef]);

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
