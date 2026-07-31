import type { PierDiffViewRenderWindow } from "@pier/ui/diff-view/index.tsx";
import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import { type RefObject, useCallback, useEffect, useMemo } from "react";
import { isReviewEntryBodyHydratable } from "../review/document/body-class.ts";
import {
  composeReviewDocumentDemand,
  type ReviewDocumentDemand,
  reviewDocumentDemandForRenderWindow,
} from "../review/document/demand.ts";
import type { GitReviewDocumentLoader } from "../review/document/loader.ts";

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
}): (window: PierDiffViewRenderWindow) => void {
  // 金标准：lookahead / selection-radius 只在 content 序上扩展，禁止把 pure rename 拉进 demand
  const entryKeysInOrder = useMemo(
    () =>
      entries
        .filter((entry) => isReviewEntryBodyHydratable(entry))
        .map((entry) => entry.entryKey),
    [entries]
  );
  const validEntryKeys = useMemo(
    () => new Set(entries.map((entry) => entry.entryKey)),
    [entries]
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
        protectSelectedAnchor: getSelectedEntryKey() !== null,
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
    // navigationPending / entries 变化时重算 demand；prefetch 覆盖只走 ref，不触发 React。
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
  }, [applyDemand, applyRenderWindow, navigationPending, renderWindowRef]);
  return requestRenderWindow;
}
