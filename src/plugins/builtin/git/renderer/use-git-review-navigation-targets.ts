import type { PierDiffViewHandle } from "@pier/ui/diff-view.tsx";
import { type RefObject, useCallback } from "react";
import type { GitReviewDocumentLoader } from "./git-review-document-loader.ts";
import {
  findReviewNavigationTarget,
  isReviewPlaceholderCacheKey,
  type PendingReviewNavigation,
} from "./git-review-navigation.ts";

export function useGitReviewNavigationTargets(options: {
  readonly correctiveTimersRef: RefObject<ReturnType<typeof setTimeout>[]>;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly itemCacheKeysRef: RefObject<ReadonlyMap<string, string>>;
  readonly lastScrolledCacheKeyRef: RefObject<string | null>;
  readonly lastScrolledSectionRef: RefObject<string | null>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly pendingNavigationRef: RefObject<PendingReviewNavigation | null>;
  readonly renderedGenerationRef: RefObject<number>;
  readonly cancelCorrectiveTimers: () => void;
  readonly correctiveCountRef: RefObject<number>;
  readonly projectionRevisionRef: RefObject<number>;
}): {
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
  readonly isNavTargetVisible: (
    sectionId: string,
    cacheKey?: string
  ) => boolean;
  readonly schedulePrecisionCorrectives: (
    navigation: PendingReviewNavigation,
    sectionId: string
  ) => void;
} {
  const {
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
  } = options;

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

  /**
   * 可 scroll：账本上已有 sectionKey（含 estimate）。
   * stable-ledger K6：不再要求 body loaded。
   */
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

  /**
   * 导航是否贴到目标文件顶。
   * - 始终调用 isItemVisible（测例 + identity）
   * - 若 captureTopAnchor 可用：以顶部文件 id 为准（避免估高同源假成功）
   * - 否则退回 isItemVisible
   */
  const isNavTargetVisible = useCallback(
    (sectionId: string, cacheKey?: string) => {
      const handle = diffHandleRef.current;
      if (!handle) {
        return false;
      }
      const domHit =
        cacheKey === undefined
          ? handle.isItemVisible(sectionId) === true
          : handle.isItemVisible(sectionId, cacheKey) === true ||
            handle.isItemVisible(sectionId) === true;
      const top = handle.captureTopAnchor?.();
      if (top != null && typeof top.id === "string") {
        return top.id === sectionId;
      }
      return domHit;
    },
    [diffHandleRef]
  );

  /**
   * 主路径 1× smooth 结束后：仅当顶部仍不是目标时，最多 2 次 instant 贴齐。
   * 禁止 80–200ms 内纠正（会打断 smooth，体感像「跳一下再展开」）。
   * 顶部已是目标时：estimate→loaded 只向下撑开正文，不再重滚。
   */
  const schedulePrecisionCorrectives = useCallback(
    (navigation: PendingReviewNavigation, sectionId: string) => {
      cancelCorrectiveTimers();
      correctiveCountRef.current = 0;
      // ~smooth 时长后再查；第二次兜底上方水合改高
      const delaysMs = [420, 780];
      correctiveTimersRef.current = delaysMs.map((ms) =>
        setTimeout(() => {
          if (pendingNavigationRef.current !== navigation) {
            return;
          }
          if (correctiveCountRef.current >= 2) {
            return;
          }
          const target = currentScrollTarget(navigation);
          if (target?.sectionId !== sectionId) {
            return;
          }
          // 顶部已是目标：允许正文展开，不 instant 重跳
          if (isNavTargetVisible(sectionId, target.cacheKey)) {
            return;
          }
          const ok =
            diffHandleRef.current?.scrollToItem(sectionId, {
              behavior: "instant",
            }) === true;
          if (ok) {
            correctiveCountRef.current += 1;
            lastScrolledSectionRef.current = sectionId;
            lastScrolledCacheKeyRef.current = target.cacheKey;
          }
        }, ms)
      );
    },
    [
      cancelCorrectiveTimers,
      correctiveCountRef,
      correctiveTimersRef,
      currentScrollTarget,
      diffHandleRef,
      isNavTargetVisible,
      lastScrolledCacheKeyRef,
      lastScrolledSectionRef,
      pendingNavigationRef,
    ]
  );

  const currentProjectionRevision = useCallback(
    (navigation: PendingReviewNavigation): number | null =>
      currentLoadedTarget(navigation) === null
        ? null
        : projectionRevisionRef.current,
    [currentLoadedTarget, projectionRevisionRef]
  );

  return {
    currentLoadedTarget,
    currentProjectedTarget,
    currentProjectionRevision,
    currentScrollTarget,
    isNavTargetVisible,
    schedulePrecisionCorrectives,
  };
}
