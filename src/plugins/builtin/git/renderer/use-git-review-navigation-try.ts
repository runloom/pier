import type { PierDiffViewHandle } from "@pier/ui/diff-view.tsx";
import type { RefObject } from "react";
import type { GitReviewDocumentLoader } from "./git-review-document-loader.ts";
import {
  isReviewNavigationTerminal,
  type PendingReviewNavigation,
  reviewNavigationKey,
} from "./git-review-navigation.ts";

/** 树导航统一 smooth（对齐 DiffsHub ReviewUI）；任意远近同一行为、同一套耗时。 */
export const TREE_NAV_SCROLL_BEHAVIOR = "smooth" as const;

export function tryGitReviewPendingNavigation(options: {
  readonly activeNavigationKeyRef: RefObject<string | null>;
  readonly currentLoadedTarget: (
    navigation: PendingReviewNavigation
  ) => { readonly cacheKey: string; readonly sectionId: string } | null;
  readonly currentScrollTarget: (
    navigation: PendingReviewNavigation
  ) => { readonly cacheKey: string; readonly sectionId: string } | null;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly finishTerminal: () => void;
  readonly lastScrolledCacheKeyRef: RefObject<string | null>;
  readonly lastScrolledSectionRef: RefObject<string | null>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly pendingNavigationRef: RefObject<PendingReviewNavigation | null>;
  readonly schedulePrecisionCorrectives: (
    navigation: PendingReviewNavigation,
    sectionId: string
  ) => void;
  readonly scheduleScrollRetry: () => void;
  readonly scrollRetryCountRef: RefObject<number>;
  readonly verify: (navigation: PendingReviewNavigation) => void;
}): void {
  const {
    activeNavigationKeyRef,
    currentLoadedTarget,
    currentScrollTarget,
    diffHandleRef,
    finishTerminal,
    lastScrolledCacheKeyRef,
    lastScrolledSectionRef,
    loaderRef,
    pendingNavigationRef,
    schedulePrecisionCorrectives,
    scheduleScrollRetry,
    scrollRetryCountRef,
    verify,
  } = options;

  const navigation = pendingNavigationRef.current;
  if (!navigation) {
    return;
  }
  const navigationKey = reviewNavigationKey(navigation);
  const target = currentScrollTarget(navigation);
  if (!target) {
    const loader = loaderRef.current;
    if (
      currentLoadedTarget(navigation) === null &&
      loader &&
      isReviewNavigationTerminal(
        loader.getResource(navigation.entryKey),
        loader.isSettled(),
        navigation.sectionKey
      )
    ) {
      finishTerminal();
    } else {
      scheduleScrollRetry();
    }
    return;
  }

  const alreadyScrolledSection =
    lastScrolledSectionRef.current === target.sectionId;

  // 已发过主 smooth：不再因 cacheKey 变化 instant 重跳（正文展开不是定位失败）
  // 顶部未贴准的纠正只交给 schedulePrecisionCorrectives（smooth 结束后）
  if (alreadyScrolledSection) {
    lastScrolledCacheKeyRef.current = target.cacheKey;
    if (activeNavigationKeyRef.current !== navigationKey) {
      verify(navigation);
    }
    return;
  }

  // 主路径：一律 1× smooth（远近一致）；中途不 instant
  const scrolled =
    diffHandleRef.current?.scrollToItem(target.sectionId, {
      behavior: TREE_NAV_SCROLL_BEHAVIOR,
    }) === true;
  if (!scrolled) {
    scheduleScrollRetry();
    return;
  }

  scrollRetryCountRef.current = 0;
  lastScrolledSectionRef.current = target.sectionId;
  lastScrolledCacheKeyRef.current = target.cacheKey;
  schedulePrecisionCorrectives(navigation, target.sectionId);
  if (activeNavigationKeyRef.current !== navigationKey) {
    verify(navigation);
  }
}
