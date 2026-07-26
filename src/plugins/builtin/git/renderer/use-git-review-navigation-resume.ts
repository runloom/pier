import type { PierDiffViewHandle } from "@pier/ui/diff-view.tsx";
import type { RefObject } from "react";
import {
  type PendingReviewNavigation,
  resolveReviewSectionKey,
  reviewNavigationKey,
} from "./git-review-navigation.ts";

/**
 * projection/layout 后的 resume：同 navigationKey 已投影则不 re-scroll；
 * section 重绑可 scroll 一次；缺失内容才重新 demand。
 */
export function resumeGitReviewSelectedNavigation(options: {
  readonly applyNavigationDemand: (entryKey: string) => void;
  readonly currentLoadedTarget: (
    navigation: PendingReviewNavigation
  ) => { readonly cacheKey: string; readonly sectionId: string } | null;
  readonly currentProjectionRevision: (
    navigation: PendingReviewNavigation
  ) => number | null;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly failedNavigationKeyRef: RefObject<string | null>;
  readonly firstSectionIdByEntryKeyRef: RefObject<ReadonlyMap<string, string>>;
  readonly pendingNavigationRef: RefObject<PendingReviewNavigation | null>;
  readonly selectedEntryKeyRef: RefObject<string | null>;
  readonly selectedSectionKeyRef: {
    current: string | null;
  };
  readonly setNavigationPending: (pending: boolean) => void;
  readonly settledProjectionRef: {
    current: {
      readonly navigationKey: string;
      readonly revision: number;
    } | null;
  };
}): void {
  const selected = options.selectedEntryKeyRef.current;
  if (!(selected && options.pendingNavigationRef.current === null)) {
    return;
  }
  const selectedSection = resolveReviewSectionKey({
    entryKey: selected,
    entryKeyBySectionId: options.entryKeyBySectionIdRef.current,
    firstSectionIdByEntryKey: options.firstSectionIdByEntryKeyRef.current,
    preferredSectionKey: options.selectedSectionKeyRef.current,
  });
  if (!selectedSection) {
    return;
  }
  options.selectedSectionKeyRef.current = selectedSection;
  const navigation = {
    entryKey: selected,
    generation: options.documentGenerationRef.current,
    sectionKey: selectedSection,
  };
  const navigationKey = reviewNavigationKey(navigation);
  if (options.failedNavigationKeyRef.current === navigationKey) {
    return;
  }
  const revision = options.currentProjectionRevision(navigation);
  if (revision === null) {
    return;
  }
  const settled = options.settledProjectionRef.current;
  if (
    settled?.navigationKey === navigationKey &&
    settled.revision === revision
  ) {
    return;
  }
  // 目标已在投影中：
  // - 同一 navigationKey 已 settle：用户拥有滚动，禁止再 scrollToItem。
  // - section 重绑（navigationKey 变）：允许一次 scroll。
  const target = options.currentLoadedTarget(navigation);
  if (target !== null) {
    const sameTarget = settled?.navigationKey === navigationKey;
    if (sameTarget) {
      options.settledProjectionRef.current = { navigationKey, revision };
      return;
    }
    options.settledProjectionRef.current = { navigationKey, revision };
    if (
      options.diffHandleRef.current?.isItemVisible(
        target.sectionId,
        target.cacheKey
      )
    ) {
      return;
    }
    options.diffHandleRef.current?.scrollToItem(target.sectionId);
    return;
  }
  options.pendingNavigationRef.current = navigation;
  options.applyNavigationDemand(selected);
  options.setNavigationPending(true);
}
