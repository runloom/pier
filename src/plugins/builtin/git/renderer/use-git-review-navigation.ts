import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewNavigationMemberReason } from "./git-review-document-demand.ts";
import {
  type PendingReviewNavigation,
  resolveReviewSectionKey,
} from "./git-review-navigation.ts";
import { resumeGitReviewSelectedNavigation } from "./use-git-review-navigation-resume.ts";
import { useGitReviewNavigationTargets } from "./use-git-review-navigation-targets.ts";
import { tryGitReviewPendingNavigation } from "./use-git-review-navigation-try.ts";
import type { UseGitReviewNavigationOptions } from "./use-git-review-navigation-types.ts";
import { scheduleGitReviewNavigationVerify } from "./use-git-review-navigation-verify.ts";

export function useGitReviewNavigation({
  applyNavigationDemand,
  onNavigationSettled,
  onNavigationStarted,
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
  readonly getNavigationMemberReason: () => ReviewNavigationMemberReason | null;
  readonly getSelectedEntryKey: () => string | null;
  readonly getSelectedSectionKey: () => string | null;
  readonly hasPendingNavigation: () => boolean;
  readonly navigationError: Error | null;
  /** 每次 beginNavigation 递增，驱动 layout 在 pending 保持 true 时仍重试 scroll。 */
  readonly navigationEpoch: number;
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
  const navigationMemberReasonRef = useRef<ReviewNavigationMemberReason | null>(
    null
  );
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
  const [navigationEpoch, setNavigationEpoch] = useState(0);
  const [navigationPending, setNavigationPending] = useState(false);
  /** 定位落定后延迟卸 sticky，避免立刻 cap 裁成员把视口内容抖掉。 */
  const stickyClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  /** 本轮 pending 已对哪个 sectionId 发起过**主** scroll（smooth 一次）。 */
  const lastScrolledSectionRef = useRef<string | null>(null);
  /** 上次滚动时目标 cacheKey；estimate→loaded 后高度变，须再滚。 */
  const lastScrolledCacheKeyRef = useRef<string | null>(null);
  /** getItem 未就绪时的 rAF 重试句柄。 */
  const scrollRetryFrameRef = useRef<number | null>(null);
  const scrollRetryCountRef = useRef(0);
  const tryPendingNavigationRef = useRef<() => void>(() => undefined);
  /** smooth 结束后的精度纠正定时器（instant，有界次数）。 */
  const correctiveTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const correctiveCountRef = useRef(0);

  const cancelScrollRetryFrame = useCallback(() => {
    if (scrollRetryFrameRef.current !== null) {
      cancelAnimationFrame(scrollRetryFrameRef.current);
      scrollRetryFrameRef.current = null;
    }
  }, []);

  const cancelCorrectiveTimers = useCallback(() => {
    for (const timer of correctiveTimersRef.current) {
      clearTimeout(timer);
    }
    correctiveTimersRef.current = [];
  }, []);

  const scheduleScrollRetry = useCallback(() => {
    if (scrollRetryCountRef.current >= 45) {
      return;
    }
    cancelScrollRetryFrame();
    scrollRetryFrameRef.current = requestAnimationFrame(() => {
      scrollRetryFrameRef.current = null;
      scrollRetryCountRef.current += 1;
      tryPendingNavigationRef.current();
    });
  }, [cancelScrollRetryFrame]);

  const cancelStickyClearTimer = useCallback(() => {
    if (stickyClearTimerRef.current !== null) {
      clearTimeout(stickyClearTimerRef.current);
      stickyClearTimerRef.current = null;
    }
  }, []);

  /**
   * pending 结束后收敛 sticky pin + member cap。
   * 默认延迟一帧+短 settle，让 scrollTo 与 measure 先稳；用户再滚/新导航时立即清。
   */
  const clearStickyAfterSettle = useCallback(
    (options?: { readonly immediate?: boolean }) => {
      cancelStickyClearTimer();
      const run = (): void => {
        stickyClearTimerRef.current = null;
        onNavigationSettled?.();
        loaderRef.current?.setStickyMemberEntryKeys?.([]);
      };
      if (options?.immediate === true) {
        run();
        return;
      }
      stickyClearTimerRef.current = setTimeout(run, 160);
    },
    [cancelStickyClearTimer, loaderRef, onNavigationSettled]
  );

  const cancelVerification = useCallback(() => {
    cancelVerificationRef.current?.();
    cancelVerificationRef.current = null;
    activeNavigationKeyRef.current = null;
    cancelScrollRetryFrame();
    cancelCorrectiveTimers();
  }, [cancelCorrectiveTimers, cancelScrollRetryFrame]);

  const {
    currentLoadedTarget,
    currentProjectedTarget,
    currentProjectionRevision,
    currentScrollTarget,
    isNavTargetVisible,
    schedulePrecisionCorrectives,
  } = useGitReviewNavigationTargets({
    cancelCorrectiveTimers,
    correctiveCountRef,
    correctiveTimersRef,
    diffHandleRef,
    documentGenerationRef,
    itemCacheKeysRef,
    lastScrolledCacheKeyRef,
    lastScrolledSectionRef,
    loaderRef,
    pendingNavigationRef,
    projectionRevisionRef,
    renderedGenerationRef,
  });

  const finishTerminal = useCallback(() => {
    pendingNavigationRef.current = null;
    navigationMemberReasonRef.current = null;
    failedNavigationKeyRef.current = null;
    settledProjectionRef.current = null;
    setNavigationError(null);
    setNavigationPending(false);
    cancelVerification();
    // pending 先清，再 emit 让 session 走 settled 成员公式并卸 sticky pin
    clearStickyAfterSettle();
  }, [cancelVerification, clearStickyAfterSettle]);

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
      scheduleGitReviewNavigationVerify({
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
      });
    },
    [
      cancelCorrectiveTimers,
      cancelVerification,
      clearStickyAfterSettle,
      currentLoadedTarget,
      currentProjectedTarget,
      currentProjectionRevision,
      currentScrollTarget,
      diffHandleRef,
      finishTerminal,
      isNavTargetVisible,
      loaderRef,
      pendingAnchorRef,
    ]
  );

  const tryPendingNavigation = useCallback(() => {
    tryGitReviewPendingNavigation({
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
    });
  }, [
    currentLoadedTarget,
    currentScrollTarget,
    diffHandleRef,
    finishTerminal,
    loaderRef,
    schedulePrecisionCorrectives,
    scheduleScrollRetry,
    verify,
  ]);
  tryPendingNavigationRef.current = tryPendingNavigation;

  const beginNavigation = useCallback(
    (target: { readonly entryKey: string; readonly sectionKey: string }) => {
      pendingAnchorRef.current = null;
      cancelStickyClearTimer();
      cancelVerification();
      lastScrolledSectionRef.current = null;
      lastScrolledCacheKeyRef.current = null;
      scrollRetryCountRef.current = 0;
      correctiveCountRef.current = 0;
      failedNavigationKeyRef.current = null;
      settledProjectionRef.current = null;
      selectedEntryKeyRef.current = target.entryKey;
      selectedSectionKeyRef.current = target.sectionKey;
      // ★ MUST：pending 闸门先于任何会 emit/sync 的 loader 调用（sticky 单调 / suppress）
      pendingNavigationRef.current = {
        entryKey: target.entryKey,
        generation: documentGenerationRef.current,
        sectionKey: target.sectionKey,
      };
      navigationMemberReasonRef.current = "tree";
      setNavigationPending(true);
      setNavigationEpoch((value) => value + 1);
      setNavigationError(null);
      onNavigationStarted?.(target.entryKey);
      // boost selected + 保留 window（禁止 pin-only exclusive replace）
      applyNavigationDemand(target.entryKey);
    },
    [
      applyNavigationDemand,
      cancelStickyClearTimer,
      cancelVerification,
      documentGenerationRef,
      onNavigationStarted,
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
          navigationMemberReasonRef.current = null;
          setNavigationPending(false);
          return null;
        }
        selectedSectionKeyRef.current = selectedSection;
        // pending 先于 demand，与 beginNavigation 同构（reason=rebind）
        pendingNavigationRef.current = {
          entryKey: selected,
          generation,
          sectionKey: selectedSection,
        };
        navigationMemberReasonRef.current = "rebind";
        setNavigationPending(true);
        setNavigationEpoch((value) => value + 1);
        applyNavigationDemand(selected);
        pendingAnchorRef.current = null;
        return selected;
      }
      if (selected) {
        selectedEntryKeyRef.current = null;
        selectedSectionKeyRef.current = null;
      }
      pendingNavigationRef.current = null;
      navigationMemberReasonRef.current = null;
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
    resumeGitReviewSelectedNavigation({
      applyNavigationDemand,
      currentLoadedTarget,
      currentProjectionRevision,
      diffHandleRef,
      documentGenerationRef,
      entryKeyBySectionIdRef,
      failedNavigationKeyRef,
      firstSectionIdByEntryKeyRef,
      navigationMemberReasonRef,
      pendingNavigationRef,
      selectedEntryKeyRef,
      selectedSectionKeyRef,
      setNavigationPending,
      settledProjectionRef,
    });
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
    // 滚动热路径：无导航/选中时短路，禁止每帧 setState + sticky emit
    const hadPending = pendingNavigationRef.current !== null;
    const hadSelected = selectedEntryKeyRef.current !== null;
    const hadError = navigationError !== null;
    if (!(hadPending || hadSelected || hadError || navigationPending)) {
      return;
    }
    selectedEntryKeyRef.current = null;
    selectedSectionKeyRef.current = null;
    pendingNavigationRef.current = null;
    navigationMemberReasonRef.current = null;
    failedNavigationKeyRef.current = null;
    settledProjectionRef.current = null;
    loaderRef.current?.setProtectedEntryKey(null);
    setNavigationError(null);
    if (navigationPending || hadPending) {
      setNavigationPending(false);
      cancelVerification();
      // 用户已接手滚动：立即卸 sticky，勿延迟
      clearStickyAfterSettle({ immediate: true });
    } else {
      cancelVerification();
    }
  }, [
    cancelVerification,
    clearStickyAfterSettle,
    loaderRef,
    navigationError,
    navigationPending,
  ]);

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
    // scroll 留给 navigationPending layout（子 apply 之后），禁止同步抢滚
    beginNavigation({ entryKey: selected, sectionKey: selectedSection });
  }, [beginNavigation, firstSectionIdByEntryKeyRef]);
  const hasPendingNavigation = useCallback(
    () => pendingNavigationRef.current !== null,
    []
  );
  const getNavigationMemberReason = useCallback(
    () => navigationMemberReasonRef.current,
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

  useEffect(
    () => () => {
      cancelStickyClearTimer();
      cancelScrollRetryFrame();
      cancelCorrectiveTimers();
    },
    [cancelCorrectiveTimers, cancelScrollRetryFrame, cancelStickyClearTimer]
  );

  return {
    beginGeneration,
    beginNavigation,
    cancelVerification,
    clearForUserIntent,
    getNavigationMemberReason,
    getSelectedEntryKey,
    getSelectedSectionKey,
    hasPendingNavigation,
    navigationError,
    navigationEpoch,
    navigationPending,
    notifyProjectionChanged,
    resumeSelectedNavigation,
    retryNavigation,
    tryPendingNavigation,
  };
}
