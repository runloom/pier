import type { PierDiffViewRenderWindow } from "@pier/ui/diff-view.tsx";
import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import { type RefObject, useCallback, useEffect, useMemo } from "react";
import {
  composeReviewDocumentDemand,
  type ReviewDocumentDemand,
  reviewDocumentDemandForRenderWindow,
} from "./git-review-document-demand.ts";
import type { GitReviewDocumentLoader } from "./git-review-document-loader.ts";

export function useGitReviewDocumentDemand({
  currentDemandRef,
  entries,
  entryKeyBySectionIdRef,
  getSelectedEntryKey,
  hasPendingNavigation,
  loaderRef,
  navigationPending,
  renderWindowRef,
  seedEntryKeysRef,
  demandPrefetchEntryKeysRef,
  demandPrefetchVersion,
}: {
  readonly currentDemandRef: RefObject<ReviewDocumentDemand>;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly getSelectedEntryKey: () => string | null;
  readonly hasPendingNavigation: () => boolean;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly navigationPending: boolean;
  readonly renderWindowRef: RefObject<PierDiffViewRenderWindow | null>;
  readonly seedEntryKeysRef: RefObject<readonly string[]>;
  readonly demandPrefetchEntryKeysRef: RefObject<ReadonlySet<string>>;
  readonly demandPrefetchVersion: number;
}): (window: PierDiffViewRenderWindow) => void {
  const entryKeysInOrder = useMemo(
    () => entries.map((entry) => entry.entryKey),
    [entries]
  );
  const validEntryKeys = useMemo(
    () => new Set(entryKeysInOrder),
    [entryKeysInOrder]
  );
  const applyDemand = useCallback(
    (windowDemand: ReviewDocumentDemand, pending: boolean) => {
      const loader = loaderRef.current;
      if (!loader) {
        return;
      }
      const demand = composeReviewDocumentDemand({
        entryKeysInOrder,
        navigationPending: pending,
        seedEntryKeys: seedEntryKeysRef.current,
        selectedEntryKey: getSelectedEntryKey(),
        demandPrefetchEntryKeys: demandPrefetchEntryKeysRef.current,
        windowDemand,
      });
      currentDemandRef.current = demand;
      loader.setWindowDemand(demand);
    },
    [
      currentDemandRef,
      entryKeysInOrder,
      getSelectedEntryKey,
      loaderRef,
      seedEntryKeysRef,
      demandPrefetchEntryKeysRef,
    ]
  );
  const applyRenderWindow = useCallback(
    (window: PierDiffViewRenderWindow, pending: boolean) => {
      renderWindowRef.current = window;
      const windowDemand = reviewDocumentDemandForRenderWindow(
        entryKeyBySectionIdRef.current,
        validEntryKeys,
        window
      );
      applyDemand(windowDemand, pending);
    },
    [applyDemand, entryKeyBySectionIdRef, renderWindowRef, validEntryKeys]
  );
  const requestRenderWindow = useCallback(
    (window: PierDiffViewRenderWindow) => {
      applyRenderWindow(window, hasPendingNavigation());
    },
    [applyRenderWindow, hasPendingNavigation]
  );
  useEffect(() => {
    // demandPrefetchVersion 是 membership epoch：变化时重算 lookahead demand。
    const prefetchEpoch = demandPrefetchVersion;
    if (prefetchEpoch < 0) {
      return;
    }
    const window = renderWindowRef.current;
    if (window !== null) {
      applyRenderWindow(window, navigationPending);
      return;
    }
    // 无 Pierre window 时仍喂 seed（或 nav selected）demand。
    applyDemand(
      { bufferedEntryKeys: [], visibleEntryKeys: [] },
      navigationPending
    );
  }, [
    applyDemand,
    applyRenderWindow,
    navigationPending,
    renderWindowRef,
    demandPrefetchVersion,
  ]);
  return requestRenderWindow;
}
