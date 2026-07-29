import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReviewDocumentProjection } from "./git-review-document-projection.ts";
import {
  isReviewEstimateCacheKey,
  isReviewPlaceholderCacheKey,
} from "./git-review-navigation.ts";
import type { GitReviewReadingSurface } from "./git-review-reading-surface.ts";
import type { ReviewSurfaceNavigationRequest } from "./git-review-surface-types.ts";

export function useGitReviewSurfaceNavigationHandoff(options: {
  readonly active: boolean;
  readonly applyNavigationDemand: (entryKey: string) => void;
  readonly beginNavigation: (target: {
    readonly anchorOffset?: number;
    readonly entryKey: string;
    readonly sectionKey: string;
  }) => void;
  readonly diffBase: GitReviewReadingSurface;
  readonly hasPendingNavigation: () => boolean;
  readonly navigationPending: boolean;
  readonly navigationRequest: ReviewSurfaceNavigationRequest | null;
  readonly onNavigationMaterialized: (
    request: ReviewSurfaceNavigationRequest
  ) => void;
  readonly onSurfaceNavigationSettled: (
    request: ReviewSurfaceNavigationRequest
  ) => void;
  readonly projection: ReviewDocumentProjection;
  readonly setSelectedTreeTarget: (target: {
    readonly entryKey: string;
    readonly sectionKey: string;
  }) => void;
}): void {
  const {
    active,
    applyNavigationDemand,
    beginNavigation,
    diffBase,
    hasPendingNavigation,
    navigationPending,
    navigationRequest,
    onNavigationMaterialized,
    onSurfaceNavigationSettled,
    projection,
    setSelectedTreeTarget,
  } = options;
  const handledNavigationNonceRef = useRef(0);
  const preparedNavigationNonceRef = useRef(0);

  useEffect(() => {
    if (
      active ||
      navigationRequest === null ||
      navigationRequest.surface !== diffBase ||
      navigationRequest.nonce === preparedNavigationNonceRef.current
    ) {
      return;
    }
    preparedNavigationNonceRef.current = navigationRequest.nonce;
    setSelectedTreeTarget({
      entryKey: navigationRequest.entryKey,
      sectionKey: navigationRequest.treeSectionKey,
    });
    applyNavigationDemand(navigationRequest.entryKey);
  }, [
    active,
    applyNavigationDemand,
    diffBase,
    navigationRequest,
    setSelectedTreeTarget,
  ]);

  useEffect(() => {
    if (
      !active ||
      navigationRequest === null ||
      navigationRequest.surface !== diffBase ||
      handledNavigationNonceRef.current !== navigationRequest.nonce ||
      navigationPending ||
      hasPendingNavigation()
    ) {
      return;
    }
    onSurfaceNavigationSettled(navigationRequest);
  }, [
    active,
    diffBase,
    hasPendingNavigation,
    navigationPending,
    navigationRequest,
    onSurfaceNavigationSettled,
  ]);

  useEffect(() => {
    if (
      active ||
      navigationRequest === null ||
      navigationRequest.surface !== diffBase ||
      projection.sourceIndexGeneration <
        (navigationRequest.minimumIndexGeneration ?? 0)
    ) {
      return;
    }
    const target = projection.items.find(
      (item) => item.id === navigationRequest.itemId
    );
    if (
      target === undefined ||
      isReviewEstimateCacheKey(target.cacheKey) ||
      isReviewPlaceholderCacheKey(target.cacheKey)
    ) {
      return;
    }
    onNavigationMaterialized(navigationRequest);
  }, [
    active,
    diffBase,
    navigationRequest,
    onNavigationMaterialized,
    projection.items,
    projection.sourceIndexGeneration,
  ]);

  useLayoutEffect(() => {
    if (
      !active ||
      navigationRequest === null ||
      navigationRequest.surface !== diffBase ||
      navigationRequest.nonce === handledNavigationNonceRef.current
    ) {
      return;
    }
    handledNavigationNonceRef.current = navigationRequest.nonce;
    setSelectedTreeTarget({
      entryKey: navigationRequest.entryKey,
      sectionKey: navigationRequest.treeSectionKey,
    });
    beginNavigation({
      ...(navigationRequest.anchorOffset === undefined
        ? {}
        : { anchorOffset: navigationRequest.anchorOffset }),
      entryKey: navigationRequest.entryKey,
      sectionKey: navigationRequest.itemId,
    });
  }, [
    active,
    beginNavigation,
    diffBase,
    navigationRequest,
    setSelectedTreeTarget,
  ]);
}
