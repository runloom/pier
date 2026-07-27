import type { PierDiffViewHandle } from "@pier/ui/diff-view.tsx";
import type { RefObject } from "react";
import type { ReviewNavigationMemberReason } from "./git-review-document-demand.ts";
import type { GitReviewDocumentLoader } from "./git-review-document-loader.ts";
import type { PendingReviewAnchor } from "./git-review-document-projection.ts";
import {
  isReviewNavigationTerminal,
  type PendingReviewNavigation,
  reviewNavigationKey,
  scheduleReviewNavigationVerification,
} from "./git-review-navigation.ts";

export function scheduleGitReviewNavigationVerify(options: {
  readonly activeNavigationKeyRef: RefObject<string | null>;
  readonly cancelCorrectiveTimers: () => void;
  readonly cancelVerification: () => void;
  readonly cancelVerificationRef: RefObject<(() => void) | null>;
  readonly clearStickyAfterSettle: (options?: {
    readonly immediate?: boolean;
  }) => void;
  readonly currentLoadedTarget: (
    navigation: PendingReviewNavigation
  ) => { readonly cacheKey: string; readonly sectionId: string } | null;
  readonly currentProjectedTarget: (
    navigation: PendingReviewNavigation
  ) => { readonly cacheKey: string; readonly sectionId: string } | null;
  readonly currentProjectionRevision: (
    navigation: PendingReviewNavigation
  ) => number | null;
  readonly currentScrollTarget: (
    navigation: PendingReviewNavigation
  ) => { readonly cacheKey: string; readonly sectionId: string } | null;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly failedNavigationKeyRef: RefObject<string | null>;
  readonly finishTerminal: () => void;
  readonly isNavTargetVisible: (
    sectionId: string,
    cacheKey?: string
  ) => boolean;
  readonly lastScrolledSectionRef: RefObject<string | null>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly navigation: PendingReviewNavigation;
  readonly navigationMemberReasonRef: RefObject<ReviewNavigationMemberReason | null>;
  readonly pendingAnchorRef: RefObject<PendingReviewAnchor | null>;
  readonly pendingNavigationRef: RefObject<PendingReviewNavigation | null>;
  readonly setNavigationError: (error: Error | null) => void;
  readonly setNavigationPending: (pending: boolean) => void;
  readonly settledProjectionRef: RefObject<{
    readonly navigationKey: string;
    readonly revision: number;
  } | null>;
}): void {
  const {
    activeNavigationKeyRef,
    cancelCorrectiveTimers,
    cancelVerification,
    cancelVerificationRef,
    clearStickyAfterSettle,
    currentLoadedTarget,
    currentProjectedTarget,
    currentProjectionRevision,
    currentScrollTarget,
    diffHandleRef,
    failedNavigationKeyRef,
    finishTerminal,
    isNavTargetVisible,
    lastScrolledSectionRef,
    loaderRef,
    navigation,
    navigationMemberReasonRef,
    pendingAnchorRef,
    pendingNavigationRef,
    setNavigationError,
    setNavigationPending,
    settledProjectionRef,
  } = options;

  const navigationKey = reviewNavigationKey(navigation);
  if (activeNavigationKeyRef.current === navigationKey) {
    return;
  }
  cancelVerification();
  activeNavigationKeyRef.current = navigationKey;
  cancelVerificationRef.current = scheduleReviewNavigationVerification({
    getSectionId: () => currentProjectedTarget(navigation)?.sectionId,
    isCurrent: () =>
      pendingNavigationRef.current !== null &&
      reviewNavigationKey(pendingNavigationRef.current) === navigationKey,
    isTerminal: () => {
      const loader = loaderRef.current;
      return (
        currentLoadedTarget(navigation) === null &&
        loader !== null &&
        isReviewNavigationTerminal(
          loader.getResource(navigation.entryKey),
          loader.isSettled(),
          navigation.sectionKey
        )
      );
    },
    isVisible: (sectionId) => {
      const target = currentScrollTarget(navigation);
      return (
        target?.sectionId === sectionId &&
        isNavTargetVisible(sectionId, target.cacheKey)
      );
    },
    onTerminal: finishTerminal,
    onTimeout: () => {
      const target = currentScrollTarget(navigation);
      if (target) {
        // 最后一贴：instant 精度纠正
        diffHandleRef.current?.scrollToItem(target.sectionId, {
          behavior: "instant",
        });
      }
      const visible =
        target !== null &&
        isNavTargetVisible(target.sectionId, target.cacheKey);
      if (visible) {
        pendingNavigationRef.current = null;
        navigationMemberReasonRef.current = null;
        failedNavigationKeyRef.current = null;
        cancelVerificationRef.current = null;
        activeNavigationKeyRef.current = null;
        lastScrolledSectionRef.current = null;
        cancelCorrectiveTimers();
        const revision = currentProjectionRevision(navigation);
        settledProjectionRef.current =
          revision === null ? null : { navigationKey, revision };
        pendingAnchorRef.current = null;
        setNavigationError(null);
        setNavigationPending(false);
        clearStickyAfterSettle();
        return;
      }
      pendingNavigationRef.current = null;
      navigationMemberReasonRef.current = null;
      failedNavigationKeyRef.current = navigationKey;
      cancelVerificationRef.current = null;
      activeNavigationKeyRef.current = null;
      lastScrolledSectionRef.current = null;
      cancelCorrectiveTimers();
      setNavigationError(
        new Error(
          "The selected diff did not enter the visible CodeView window before the navigation deadline."
        )
      );
      setNavigationPending(false);
      clearStickyAfterSettle();
    },
    onVisible: () => {
      pendingNavigationRef.current = null;
      navigationMemberReasonRef.current = null;
      const revision = currentProjectionRevision(navigation);
      settledProjectionRef.current =
        revision === null ? null : { navigationKey, revision };
      failedNavigationKeyRef.current = null;
      pendingAnchorRef.current = null;
      cancelVerificationRef.current = null;
      activeNavigationKeyRef.current = null;
      lastScrolledSectionRef.current = null;
      cancelCorrectiveTimers();
      setNavigationError(null);
      setNavigationPending(false);
      clearStickyAfterSettle();
    },
    maxRescrollAttempts: 0,
    scrollToItem: (sectionId) => {
      const target = currentScrollTarget(navigation);
      if (target?.sectionId !== sectionId) {
        return false;
      }
      return (
        diffHandleRef.current?.scrollToItem(sectionId, {
          behavior: "instant",
        }) === true
      );
    },
  });
}
