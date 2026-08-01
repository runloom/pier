import type { PierDiffViewRenderWindow } from "@pier/ui/diff-view/index.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewNavigationMemberReason } from "../review/document/demand.ts";
import {
  type PendingReviewNavigation,
  resolveReviewSectionKey,
} from "../review/navigation.ts";
import { syncGitReviewSelectedSection } from "./use-navigation-resume.ts";
import { useGitReviewNavigationTargets } from "./use-navigation-targets.ts";
import { tryGitReviewPendingNavigation } from "./use-navigation-try.ts";
import type { UseGitReviewNavigationOptions } from "./use-navigation-types.ts";

const EXPLICIT_NAVIGATION_STABLE_FRAMES = 2;
const RESTORE_NAVIGATION_STABLE_FRAMES = 8;

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
  renderedGenerationRef,
}: UseGitReviewNavigationOptions): {
  readonly beginGeneration: (
    entryKeys: ReadonlySet<string>,
    generation: number,
    options?: { readonly restoreSelection?: boolean }
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
  readonly notifyRenderWindowApplied: (
    window: PierDiffViewRenderWindow
  ) => void;
  readonly notifyProjectionChanged: (
    changedItemIds?: readonly string[]
  ) => void;
  readonly resumeSelectedNavigation: () => void;
  readonly restoreSelectedNavigation: () => void;
  readonly retryNavigation: () => void;
  readonly tryPendingNavigation: () => void;
} {
  const failedNavigationKeyRef = useRef<string | null>(null);
  const acknowledgedTargetWindowRevisionRef = useRef(0);
  const navigationMemberReasonRef = useRef<ReviewNavigationMemberReason | null>(
    null
  );
  const pendingNavigationRef = useRef<PendingReviewNavigation | null>(null);
  const projectionRevisionRef = useRef(0);
  const renderWindowRevisionRef = useRef(0);
  const requiredRenderWindowRevisionRef = useRef(0);
  const selectedEntryKeyRef = useRef<string | null>(initialSelectedEntryKey);
  const selectedSectionKeyRef = useRef<string | null>(
    initialSelectedSectionKey
  );
  const tryPendingNavigationRef = useRef<() => void>(() => undefined);
  const verificationCancelRef = useRef<(() => void) | null>(null);
  const viewportLayoutSettledRef = useRef(false);
  const [navigationError, setNavigationError] = useState<Error | null>(null);
  const [navigationEpoch, setNavigationEpoch] = useState(0);
  const [navigationPending, setNavigationPending] = useState(false);
  /** 本轮 pending 已对哪个 sectionId 提交过一次定位。 */
  const lastScrolledSectionRef = useRef<string | null>(null);
  /** 同一 section 的 estimate→loaded 只各提交一次定位。 */
  const lastScrolledCacheKeyRef = useRef<string | null>(null);
  const lastScrolledLayoutKeyRef = useRef<string | null>(null);
  const lastScrolledProjectionRevisionRef = useRef(-1);
  const cancelVerification = useCallback(() => {
    if (verificationCancelRef.current === null) {
      return;
    }
    verificationCancelRef.current();
    verificationCancelRef.current = null;
  }, []);
  const scheduleVerification = useCallback(() => {
    if (verificationCancelRef.current !== null) {
      return;
    }
    const finish = (): void => {
      verificationCancelRef.current = null;
      viewportLayoutSettledRef.current = true;
      tryPendingNavigationRef.current();
    };
    const stableFrames =
      navigationMemberReasonRef.current === "restore"
        ? RESTORE_NAVIGATION_STABLE_FRAMES
        : EXPLICIT_NAVIGATION_STABLE_FRAMES;
    const handle = diffHandleRef.current;
    const target = pendingNavigationRef.current;
    if (!(handle && target)) {
      return;
    }
    verificationCancelRef.current = handle.requestViewportLayoutSettled(
      target.sectionKey,
      stableFrames,
      finish
    );
  }, [diffHandleRef]);

  /** pending 结束后同步收敛 sticky pin + member cap。 */
  const clearStickyAfterSettle = useCallback(() => {
    const run = (): void => {
      onNavigationSettled?.();
      loaderRef.current?.setStickyMemberEntryKeys?.([]);
    };
    run();
  }, [loaderRef, onNavigationSettled]);

  const { currentLoadedTarget, currentScrollTarget } =
    useGitReviewNavigationTargets({
      documentGenerationRef,
      itemCacheKeysRef,
      loaderRef,
      renderedGenerationRef,
    });

  const finishTerminal = useCallback(() => {
    pendingNavigationRef.current = null;
    navigationMemberReasonRef.current = null;
    failedNavigationKeyRef.current = null;
    viewportLayoutSettledRef.current = false;
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

  const tryPendingNavigation = useCallback(() => {
    tryGitReviewPendingNavigation({
      currentLoadedTarget,
      currentScrollTarget,
      diffHandleRef,
      finishTerminal,
      acknowledgedTargetWindowRevisionRef,
      lastScrolledCacheKeyRef,
      lastScrolledLayoutKeyRef,
      lastScrolledProjectionRevisionRef,
      lastScrolledSectionRef,
      loaderRef,
      pendingNavigationRef,
      projectionRevisionRef,
      requiredRenderWindowRevisionRef,
      scheduleVerification,
      viewportLayoutSettledRef,
    });
  }, [
    currentLoadedTarget,
    currentScrollTarget,
    diffHandleRef,
    finishTerminal,
    loaderRef,
    scheduleVerification,
  ]);
  tryPendingNavigationRef.current = tryPendingNavigation;

  const armNavigation = useCallback(
    (
      target: {
        readonly anchorOffset?: number;
        readonly entryKey: string;
        readonly sectionKey: string;
      },
      reason: ReviewNavigationMemberReason
    ) => {
      cancelVerification();
      lastScrolledSectionRef.current = null;
      lastScrolledCacheKeyRef.current = null;
      lastScrolledLayoutKeyRef.current = null;
      lastScrolledProjectionRevisionRef.current = -1;
      acknowledgedTargetWindowRevisionRef.current = 0;
      requiredRenderWindowRevisionRef.current =
        renderWindowRevisionRef.current + 1;
      failedNavigationKeyRef.current = null;
      viewportLayoutSettledRef.current = false;
      selectedEntryKeyRef.current = target.entryKey;
      selectedSectionKeyRef.current = target.sectionKey;
      // ★ MUST：pending 闸门先于任何会 emit/sync 的 loader 调用（sticky 单调 / suppress）
      pendingNavigationRef.current = {
        ...(target.anchorOffset === undefined
          ? {}
          : { anchorOffset: target.anchorOffset }),
        entryKey: target.entryKey,
        generation: documentGenerationRef.current,
        sectionKey: target.sectionKey,
      };
      navigationMemberReasonRef.current = reason;
      setNavigationPending(true);
      setNavigationEpoch((value) => value + 1);
      setNavigationError(null);
      onNavigationStarted?.(target.entryKey);
      // boost selected + 保留 window（禁止 pin-only exclusive replace）
      applyNavigationDemand(target.entryKey);
    },
    [
      applyNavigationDemand,
      cancelVerification,
      documentGenerationRef,
      onNavigationStarted,
    ]
  );
  const beginNavigation = useCallback(
    (target: { readonly entryKey: string; readonly sectionKey: string }) => {
      armNavigation(target, "tree");
    },
    [armNavigation]
  );

  const beginGeneration = useCallback(
    (
      entryKeys: ReadonlySet<string>,
      generation: number,
      options?: { readonly restoreSelection?: boolean }
    ) => {
      const pendingNavigation = pendingNavigationRef.current;
      const navigationReason = navigationMemberReasonRef.current;
      cancelVerification();
      failedNavigationKeyRef.current = null;
      viewportLayoutSettledRef.current = false;
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
        if (
          (pendingNavigation && navigationReason !== null) ||
          options?.restoreSelection === true
        ) {
          // 用户主动导航/恢复滚动尚未完成时只重绑其目标；普通 index 刷新不得创建导航。
          pendingNavigationRef.current = {
            entryKey: selected,
            generation,
            sectionKey: selectedSection,
          };
          navigationMemberReasonRef.current =
            options?.restoreSelection === true ? "restore" : navigationReason;
          setNavigationPending(true);
          setNavigationEpoch((value) => value + 1);
          lastScrolledSectionRef.current = null;
          lastScrolledCacheKeyRef.current = null;
          lastScrolledLayoutKeyRef.current = null;
          lastScrolledProjectionRevisionRef.current = -1;
          acknowledgedTargetWindowRevisionRef.current = 0;
          requiredRenderWindowRevisionRef.current =
            renderWindowRevisionRef.current + 1;
          applyNavigationDemand(selected);
        } else {
          pendingNavigationRef.current = null;
          navigationMemberReasonRef.current = null;
          setNavigationPending(false);
        }
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
    ]
  );

  const resumeSelectedNavigation = useCallback(() => {
    if (pendingNavigationRef.current !== null) {
      return;
    }
    syncGitReviewSelectedSection({
      entryKeyBySectionIdRef,
      firstSectionIdByEntryKeyRef,
      selectedEntryKeyRef,
      selectedSectionKeyRef,
    });
  }, [entryKeyBySectionIdRef, firstSectionIdByEntryKeyRef]);

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
    viewportLayoutSettledRef.current = false;
    loaderRef.current?.setProtectedEntryKey(null);
    setNavigationError(null);
    if (navigationPending || hadPending) {
      setNavigationPending(false);
      cancelVerification();
      // 用户已接手滚动：立即卸 sticky，勿延迟
      clearStickyAfterSettle();
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
  const restoreSelectedNavigation = useCallback(() => {
    const selected = selectedEntryKeyRef.current;
    if (!selected) {
      return;
    }
    const selectedSection =
      selectedSectionKeyRef.current ??
      firstSectionIdByEntryKeyRef.current.get(selected) ??
      null;
    if (!selectedSection) {
      return;
    }
    armNavigation(
      { entryKey: selected, sectionKey: selectedSection },
      "restore"
    );
  }, [armNavigation, firstSectionIdByEntryKeyRef]);
  const notifyRenderWindowApplied = useCallback(
    (window: PierDiffViewRenderWindow) => {
      renderWindowRevisionRef.current += 1;
      const target = pendingNavigationRef.current;
      if (
        target !== null &&
        window.visibleItemIds.includes(target.sectionKey)
      ) {
        acknowledgedTargetWindowRevisionRef.current =
          renderWindowRevisionRef.current;
      } else if (target === null) {
        const selectedSection = selectedSectionKeyRef.current;
        if (
          selectedSection !== null &&
          !window.visibleItemIds.includes(selectedSection)
        ) {
          // Pierre 可在标签页重新显示后继续异步校正前序项高度。
          // 语义选择仍有效且用户未接手滚动时，窗口回报就是恢复信号；
          // 重新武装一次定位，直到所选项在最终布局中可见。
          restoreSelectedNavigation();
        }
      }
      tryPendingNavigationRef.current();
    },
    [restoreSelectedNavigation]
  );
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
      cancelVerification();
    },
    [cancelVerification]
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
    notifyRenderWindowApplied,
    notifyProjectionChanged,
    resumeSelectedNavigation,
    restoreSelectedNavigation,
    retryNavigation,
    tryPendingNavigation,
  };
}
