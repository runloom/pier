import { useCallback, useRef, useState } from "react";
import {
  findReviewNavigationTarget,
  isReviewNavigationTerminal,
  isReviewPlaceholderCacheKey,
  type PendingReviewNavigation,
  resolveReviewSectionKey,
  reviewNavigationKey,
  scheduleReviewNavigationVerification,
} from "./git-review-navigation.ts";
import type { UseGitReviewNavigationOptions } from "./use-git-review-navigation-types.ts";

export function useGitReviewNavigation({
  applyNavigationDemand,
  diffHandleRef,
  documentGenerationRef,
  entryKeyBySectionIdRef,
  firstSectionIdByEntryKeyRef,
  itemCacheKeysRef,
  itemIndexByIdRef,
  initialSelectedEntryKey = null,
  initialSelectedSectionKey = null,
  loaderRef,
  pendingAnchorRef,
  renderedGenerationRef,
}: UseGitReviewNavigationOptions): {
  readonly beginGeneration: (
    entryKeys: ReadonlySet<string>,
    generation: number
  ) => string | null;
  readonly beginNavigation: (target: {
    readonly entryKey: string;
    readonly sectionKey: string;
  }) => void;
  readonly cancelVerification: () => void;
  readonly clearForUserIntent: () => void;
  readonly getSelectedEntryKey: () => string | null;
  readonly getSelectedSectionKey: () => string | null;
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
  const selectedSectionKeyRef = useRef<string | null>(
    initialSelectedSectionKey
  );
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
      const sectionId = navigation.sectionKey;
      const cacheKey = itemCacheKeysRef.current.get(sectionId);
      if (!(sectionId && cacheKey)) {
        return null;
      }
      return { cacheKey, sectionId };
    },
    [documentGenerationRef, itemCacheKeysRef, renderedGenerationRef]
  );

  const currentLoadedTarget = useCallback(
    (navigation: PendingReviewNavigation) => {
      const projected = currentProjectedTarget(navigation);
      if (
        projected === null ||
        isReviewPlaceholderCacheKey(projected.cacheKey)
      ) {
        return null;
      }
      // 优先 loader 真 loaded/error；软保留时 loader 可能是 unchanged/idle，
      // 仍允许以投影真成员导航（避免 silent terminal）。
      const fromLoader = findReviewNavigationTarget(
        loaderRef.current?.getResource(navigation.entryKey),
        itemCacheKeysRef.current,
        navigation.sectionKey
      );
      return fromLoader ?? projected;
    },
    [currentProjectedTarget, itemCacheKeysRef, loaderRef]
  );

  /** 可 scroll 的目标：投影上的真成员（loaded/error 或软保留正文）。 */
  const currentScrollTarget = useCallback(
    (navigation: PendingReviewNavigation) => currentLoadedTarget(navigation),
    [currentLoadedTarget]
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
      const selectedSectionKey = selectedSectionKeyRef.current;
      if (!selectedSectionKey) {
        return;
      }
      // 无 id 列表的全量 notify 会误抬 revision → resume 排他 demand 饿死其它文件。
      // 仅在明确传入且命中选中项及其前序拓扑时推进水位。
      if (changedItemIds === undefined) {
        return;
      }
      const targetIndex = itemIndexByIdRef.current.get(selectedSectionKey);
      if (
        targetIndex === undefined ||
        changedItemIds.some((id) => {
          const index = itemIndexByIdRef.current.get(id);
          return index === undefined || index <= targetIndex;
        })
      ) {
        projectionRevisionRef.current += 1;
      }
    },
    [itemIndexByIdRef]
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
              loader.isSettled(),
              navigation.sectionKey
            )
          );
        },
        isVisible: (sectionId) => {
          // 可见性以投影为准（含暂留 ready 正文），不要卡在 loader 尚未 settle。
          // 否则「屏幕上已看到文件」仍会 4s 后误报定位失败。
          const target = currentScrollTarget(navigation);
          return (
            target?.sectionId === sectionId &&
            diffHandleRef.current?.isItemVisible(sectionId, target.cacheKey) ===
              true
          );
        },
        onTerminal: finishTerminal,
        onTimeout: () => {
          const target = currentScrollTarget(navigation);
          const visible =
            target !== null &&
            diffHandleRef.current?.isItemVisible(
              target.sectionId,
              target.cacheKey
            ) === true;
          // 内容已在视口或至少已投影：静默结束，并 settle，避免 resume 每 4s 重武装。
          if (visible || target !== null) {
            pendingNavigationRef.current = null;
            failedNavigationKeyRef.current = null;
            cancelVerificationRef.current = null;
            activeNavigationKeyRef.current = null;
            const revision = currentProjectionRevision(navigation);
            settledProjectionRef.current =
              revision === null ? null : { navigationKey, revision };
            if (visible) {
              pendingAnchorRef.current = null;
            }
            setNavigationError(null);
            setNavigationPending(false);
            return;
          }
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
        loader.isSettled(),
        navigation.sectionKey
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
    (target: { readonly entryKey: string; readonly sectionKey: string }) => {
      pendingAnchorRef.current = null;
      cancelVerification();
      failedNavigationKeyRef.current = null;
      settledProjectionRef.current = null;
      selectedEntryKeyRef.current = target.entryKey;
      selectedSectionKeyRef.current = target.sectionKey;
      const loader = loaderRef.current;
      if (loader?.getResource(target.entryKey)) {
        loader.setProtectedEntryKey(target.entryKey);
      }
      // 必须同步写入排他 demand。navigationPending 已为 true 时 effect 不会重跑，
      // 否则第二次树点击会继续只加载旧 selected，表现为“点了没反应”。
      applyNavigationDemand(target.entryKey);
      pendingNavigationRef.current = {
        entryKey: target.entryKey,
        generation: documentGenerationRef.current,
        sectionKey: target.sectionKey,
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
        const selectedSection = resolveReviewSectionKey({
          entryKey: selected,
          entryKeyBySectionId: entryKeyBySectionIdRef.current,
          firstSectionIdByEntryKey: firstSectionIdByEntryKeyRef.current,
          preferredSectionKey: selectedSectionKeyRef.current,
        });
        if (!selectedSection) {
          selectedEntryKeyRef.current = null;
          selectedSectionKeyRef.current = null;
          pendingNavigationRef.current = null;
          setNavigationPending(false);
          return null;
        }
        selectedSectionKeyRef.current = selectedSection;
        pendingNavigationRef.current = {
          entryKey: selected,
          generation,
          sectionKey: selectedSection,
        };
        applyNavigationDemand(selected);
        setNavigationPending(true);
        pendingAnchorRef.current = null;
        return selected;
      }
      if (selected) {
        selectedEntryKeyRef.current = null;
        selectedSectionKeyRef.current = null;
      }
      pendingNavigationRef.current = null;
      setNavigationPending(false);
      return null;
    },
    [
      applyNavigationDemand,
      cancelVerification,
      entryKeyBySectionIdRef,
      firstSectionIdByEntryKeyRef,
      pendingAnchorRef,
    ]
  );

  const resumeSelectedNavigation = useCallback(() => {
    const selected = selectedEntryKeyRef.current;
    if (!(selected && pendingNavigationRef.current === null)) {
      return;
    }
    const selectedSection = resolveReviewSectionKey({
      entryKey: selected,
      entryKeyBySectionId: entryKeyBySectionIdRef.current,
      firstSectionIdByEntryKey: firstSectionIdByEntryKeyRef.current,
      preferredSectionKey: selectedSectionKeyRef.current,
    });
    if (!selectedSection) {
      return;
    }
    selectedSectionKeyRef.current = selectedSection;
    const navigation = {
      entryKey: selected,
      generation: documentGenerationRef.current,
      sectionKey: selectedSection,
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
    // 目标已在投影中：只同步 settled 水位，不再排他 demand。
    // 否则 resume 会取消其它 seed/window 加载并形成活锁。
    const target = currentLoadedTarget(navigation);
    if (target !== null) {
      settledProjectionRef.current = { navigationKey, revision };
      if (
        diffHandleRef.current?.isItemVisible(target.sectionId, target.cacheKey)
      ) {
        return;
      }
      // 已投影但不可见：单次 scroll，不重新 set exclusive demand。
      diffHandleRef.current?.scrollToItem(target.sectionId);
      return;
    }
    pendingNavigationRef.current = navigation;
    applyNavigationDemand(selected);
    setNavigationPending(true);
  }, [
    applyNavigationDemand,
    currentLoadedTarget,
    currentProjectionRevision,
    diffHandleRef,
    documentGenerationRef,
    entryKeyBySectionIdRef,
    firstSectionIdByEntryKeyRef,
  ]);

  const clearForUserIntent = useCallback(() => {
    selectedEntryKeyRef.current = null;
    selectedSectionKeyRef.current = null;
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
    const selectedSection =
      selectedSectionKeyRef.current ??
      firstSectionIdByEntryKeyRef.current.get(selected) ??
      null;
    if (!selectedSection) {
      setNavigationError(null);
      return;
    }
    beginNavigation({ entryKey: selected, sectionKey: selectedSection });
    tryPendingNavigation();
  }, [beginNavigation, firstSectionIdByEntryKeyRef, tryPendingNavigation]);
  const hasPendingNavigation = useCallback(
    () => pendingNavigationRef.current !== null,
    []
  );
  const getSelectedEntryKey = useCallback(
    () => selectedEntryKeyRef.current,
    []
  );
  const getSelectedSectionKey = useCallback(
    () => selectedSectionKeyRef.current,
    []
  );

  return {
    beginGeneration,
    beginNavigation,
    cancelVerification,
    clearForUserIntent,
    getSelectedEntryKey,
    getSelectedSectionKey,
    hasPendingNavigation,
    navigationError,
    navigationPending,
    notifyProjectionChanged,
    resumeSelectedNavigation,
    retryNavigation,
    tryPendingNavigation,
  };
}
