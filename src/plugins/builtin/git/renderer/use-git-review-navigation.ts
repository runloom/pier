import type { PierDiffViewHandle } from "@pier/ui/diff-view.tsx";
import { type RefObject, useCallback, useRef, useState } from "react";
import type { GitReviewDocumentLoader } from "./git-review-document-loader.ts";
import type { PendingReviewAnchor } from "./git-review-document-projection.ts";
import {
  findReviewNavigationTarget,
  isReviewNavigationTerminal,
  isReviewPlaceholderCacheKey,
  type PendingReviewNavigation,
  reviewNavigationKey,
  scheduleReviewNavigationVerification,
} from "./git-review-navigation.ts";

interface UseGitReviewNavigationOptions {
  readonly applyNavigationDemand: (entryKey: string) => void;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly firstSectionIdByEntryKeyRef: RefObject<ReadonlyMap<string, string>>;
  readonly initialSelectedEntryKey?: string | null;
  readonly itemCacheKeysRef: RefObject<ReadonlyMap<string, string>>;
  readonly itemIndexByIdRef: RefObject<ReadonlyMap<string, number>>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly pendingAnchorRef: RefObject<PendingReviewAnchor | null>;
  readonly renderedGenerationRef: RefObject<number>;
}

export function useGitReviewNavigation({
  applyNavigationDemand,
  diffHandleRef,
  documentGenerationRef,
  firstSectionIdByEntryKeyRef,
  itemCacheKeysRef,
  itemIndexByIdRef,
  initialSelectedEntryKey = null,
  loaderRef,
  pendingAnchorRef,
  renderedGenerationRef,
}: UseGitReviewNavigationOptions): {
  readonly beginGeneration: (
    entryKeys: ReadonlySet<string>,
    generation: number
  ) => string | null;
  readonly beginNavigation: (entryKey: string) => void;
  readonly cancelVerification: () => void;
  readonly clearForUserIntent: () => void;
  readonly getSelectedEntryKey: () => string | null;
  readonly hasPendingNavigation: () => boolean;
  readonly navigationError: Error | null;
  readonly navigationPending: boolean;
  readonly notifyProjectionChanged: (
    changedItemIds?: readonly string[]
  ) => void;
  readonly resumeSelectedNavigation: () => void;
  readonly retryNavigation: () => void;
  readonly tryPendingNavigation: () => void;
} {
  const activeNavigationKeyRef = useRef<string | null>(null);
  const cancelVerificationRef = useRef<(() => void) | null>(null);
  const failedNavigationKeyRef = useRef<string | null>(null);
  const pendingNavigationRef = useRef<PendingReviewNavigation | null>(null);
  const settledProjectionRef = useRef<{
    readonly navigationKey: string;
    readonly revision: number;
  } | null>(null);
  const projectionRevisionRef = useRef(0);
  const selectedEntryKeyRef = useRef<string | null>(initialSelectedEntryKey);
  const [navigationError, setNavigationError] = useState<Error | null>(null);
  const [navigationPending, setNavigationPending] = useState(false);

  const cancelVerification = useCallback(() => {
    cancelVerificationRef.current?.();
    cancelVerificationRef.current = null;
    activeNavigationKeyRef.current = null;
  }, []);

  const currentProjectedTarget = useCallback(
    (navigation: PendingReviewNavigation) => {
      if (
        navigation.generation !== documentGenerationRef.current ||
        navigation.generation !== renderedGenerationRef.current
      ) {
        return null;
      }
      const sectionId = firstSectionIdByEntryKeyRef.current.get(
        navigation.entryKey
      );
      const cacheKey = sectionId
        ? itemCacheKeysRef.current.get(sectionId)
        : undefined;
      if (!(sectionId && cacheKey)) {
        return null;
      }
      return { cacheKey, sectionId };
    },
    [
      documentGenerationRef,
      firstSectionIdByEntryKeyRef,
      itemCacheKeysRef,
      renderedGenerationRef,
    ]
  );

  const currentLoadedTarget = useCallback(
    (navigation: PendingReviewNavigation) => {
      if (currentProjectedTarget(navigation) === null) {
        return null;
      }
      return findReviewNavigationTarget(
        loaderRef.current?.getResource(navigation.entryKey),
        itemCacheKeysRef.current
      );
    },
    [currentProjectedTarget, itemCacheKeysRef, loaderRef]
  );

  /** 可 scroll 的目标：非 placeholder 投影（含暂留 ready），不含 loading 空头。 */
  const currentScrollTarget = useCallback(
    (navigation: PendingReviewNavigation) => {
      const projected = currentProjectedTarget(navigation);
      if (
        projected === null ||
        isReviewPlaceholderCacheKey(projected.cacheKey)
      ) {
        return null;
      }
      return projected;
    },
    [currentProjectedTarget]
  );

  const finishTerminal = useCallback(() => {
    pendingNavigationRef.current = null;
    failedNavigationKeyRef.current = null;
    settledProjectionRef.current = null;
    setNavigationError(null);
    setNavigationPending(false);
    cancelVerification();
  }, [cancelVerification]);

  const currentProjectionRevision = useCallback(
    (navigation: PendingReviewNavigation): number | null =>
      currentLoadedTarget(navigation) === null
        ? null
        : projectionRevisionRef.current,
    [currentLoadedTarget]
  );

  const notifyProjectionChanged = useCallback(
    (changedItemIds?: readonly string[]) => {
      const selectedEntryKey = selectedEntryKeyRef.current;
      if (!selectedEntryKey) {
        return;
      }
      const targetId =
        firstSectionIdByEntryKeyRef.current.get(selectedEntryKey);
      const targetIndex = targetId
        ? itemIndexByIdRef.current.get(targetId)
        : undefined;
      if (
        changedItemIds === undefined ||
        targetIndex === undefined ||
        changedItemIds.some((id) => {
          const index = itemIndexByIdRef.current.get(id);
          return index === undefined || index <= targetIndex;
        })
      ) {
        projectionRevisionRef.current += 1;
      }
    },
    [firstSectionIdByEntryKeyRef, itemIndexByIdRef]
  );

  const verify = useCallback(
    (navigation: PendingReviewNavigation) => {
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
              loader.isSettled()
            )
          );
        },
        isVisible: (sectionId) => {
          const target = currentLoadedTarget(navigation);
          return (
            target?.sectionId === sectionId &&
            diffHandleRef.current?.isItemVisible(sectionId, target.cacheKey) ===
              true
          );
        },
        onTerminal: finishTerminal,
        onTimeout: () => {
          pendingNavigationRef.current = null;
          failedNavigationKeyRef.current = navigationKey;
          cancelVerificationRef.current = null;
          activeNavigationKeyRef.current = null;
          setNavigationError(
            new Error(
              "The selected diff did not enter the visible CodeView window before the navigation deadline."
            )
          );
          setNavigationPending(false);
        },
        onVisible: () => {
          pendingNavigationRef.current = null;
          const revision = currentProjectionRevision(navigation);
          settledProjectionRef.current =
            revision === null ? null : { navigationKey, revision };
          failedNavigationKeyRef.current = null;
          pendingAnchorRef.current = null;
          cancelVerificationRef.current = null;
          activeNavigationKeyRef.current = null;
          setNavigationError(null);
          setNavigationPending(false);
        },
        scrollToItem: (sectionId) => {
          // 只对 ready 投影 scroll；loading 占位不滚。
          const target = currentScrollTarget(navigation);
          return (
            target?.sectionId === sectionId &&
            diffHandleRef.current?.scrollToItem(sectionId) === true
          );
        },
      });
    },
    [
      cancelVerification,
      currentLoadedTarget,
      currentProjectedTarget,
      currentProjectionRevision,
      currentScrollTarget,
      diffHandleRef,
      finishTerminal,
      loaderRef,
      pendingAnchorRef,
    ]
  );

  const tryPendingNavigation = useCallback(() => {
    const navigation = pendingNavigationRef.current;
    if (
      !navigation ||
      activeNavigationKeyRef.current === reviewNavigationKey(navigation)
    ) {
      return;
    }
    // DiffsHub/Cursor：ready 投影才 expand+scroll；loading 空头不滚。
    const target = currentScrollTarget(navigation);
    if (target && diffHandleRef.current?.scrollToItem(target.sectionId)) {
      verify(navigation);
      return;
    }
    const loader = loaderRef.current;
    if (
      currentLoadedTarget(navigation) === null &&
      loader &&
      isReviewNavigationTerminal(
        loader.getResource(navigation.entryKey),
        loader.isSettled()
      )
    ) {
      finishTerminal();
    }
  }, [
    currentLoadedTarget,
    currentScrollTarget,
    diffHandleRef,
    finishTerminal,
    loaderRef,
    verify,
  ]);

  const beginNavigation = useCallback(
    (entryKey: string) => {
      pendingAnchorRef.current = null;
      cancelVerification();
      failedNavigationKeyRef.current = null;
      settledProjectionRef.current = null;
      selectedEntryKeyRef.current = entryKey;
      const loader = loaderRef.current;
      if (loader?.getResource(entryKey)) {
        loader.setProtectedEntryKey(entryKey);
      }
      // 必须同步写入排他 demand。navigationPending 已为 true 时 effect 不会重跑，
      // 否则第二次树点击会继续只加载旧 selected，表现为“点了没反应”。
      applyNavigationDemand(entryKey);
      pendingNavigationRef.current = {
        entryKey,
        generation: documentGenerationRef.current,
      };
      setNavigationPending(true);
      setNavigationError(null);
    },
    [
      applyNavigationDemand,
      cancelVerification,
      documentGenerationRef,
      loaderRef,
      pendingAnchorRef,
    ]
  );

  const beginGeneration = useCallback(
    (entryKeys: ReadonlySet<string>, generation: number) => {
      cancelVerification();
      failedNavigationKeyRef.current = null;
      settledProjectionRef.current = null;
      setNavigationError(null);
      const selected = selectedEntryKeyRef.current;
      if (selected && entryKeys.has(selected)) {
        pendingNavigationRef.current = {
          entryKey: selected,
          generation,
        };
        applyNavigationDemand(selected);
        setNavigationPending(true);
        pendingAnchorRef.current = null;
        return selected;
      }
      if (selected) {
        selectedEntryKeyRef.current = null;
      }
      pendingNavigationRef.current = null;
      setNavigationPending(false);
      return null;
    },
    [applyNavigationDemand, cancelVerification, pendingAnchorRef]
  );

  const resumeSelectedNavigation = useCallback(() => {
    const selected = selectedEntryKeyRef.current;
    if (!(selected && pendingNavigationRef.current === null)) {
      return;
    }
    const navigation = {
      entryKey: selected,
      generation: documentGenerationRef.current,
    };
    const navigationKey = reviewNavigationKey(navigation);
    if (failedNavigationKeyRef.current === navigationKey) {
      return;
    }
    const revision = currentProjectionRevision(navigation);
    if (revision === null) {
      return;
    }
    const settled = settledProjectionRef.current;
    if (
      settled?.navigationKey === navigationKey &&
      settled.revision === revision
    ) {
      return;
    }
    pendingNavigationRef.current = navigation;
    // 与 beginNavigation 一致：resume 时同步排他 demand，不依赖 pending 边沿 effect。
    applyNavigationDemand(selected);
    setNavigationPending(true);
  }, [applyNavigationDemand, currentProjectionRevision, documentGenerationRef]);

  const clearForUserIntent = useCallback(() => {
    selectedEntryKeyRef.current = null;
    pendingNavigationRef.current = null;
    failedNavigationKeyRef.current = null;
    settledProjectionRef.current = null;
    loaderRef.current?.setProtectedEntryKey(null);
    setNavigationError(null);
    setNavigationPending(false);
    cancelVerification();
  }, [cancelVerification, loaderRef]);

  const retryNavigation = useCallback(() => {
    const selected = selectedEntryKeyRef.current;
    if (!selected) {
      setNavigationError(null);
      return;
    }
    beginNavigation(selected);
    tryPendingNavigation();
  }, [beginNavigation, tryPendingNavigation]);
  const hasPendingNavigation = useCallback(
    () => pendingNavigationRef.current !== null,
    []
  );
  const getSelectedEntryKey = useCallback(
    () => selectedEntryKeyRef.current,
    []
  );

  return {
    beginGeneration,
    beginNavigation,
    cancelVerification,
    clearForUserIntent,
    getSelectedEntryKey,
    hasPendingNavigation,
    navigationError,
    navigationPending,
    notifyProjectionChanged,
    resumeSelectedNavigation,
    retryNavigation,
    tryPendingNavigation,
  };
}
