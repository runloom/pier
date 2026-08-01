import { type RefObject, useCallback } from "react";
import type { GitReviewDocumentLoader } from "../review/document/loader.ts";
import {
  findReviewNavigationTarget,
  isReviewEstimateCacheKey,
  isReviewPlaceholderCacheKey,
  type PendingReviewNavigation,
} from "../review/navigation.ts";

export function useGitReviewNavigationTargets(options: {
  readonly documentGenerationRef: RefObject<number>;
  readonly itemCacheKeysRef: RefObject<ReadonlyMap<string, string>>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly renderedGenerationRef: RefObject<number>;
}): {
  readonly currentLoadedTarget: (
    navigation: PendingReviewNavigation
  ) => { readonly cacheKey: string; readonly sectionId: string } | null;
  readonly currentScrollTarget: (
    navigation: PendingReviewNavigation
  ) => { readonly cacheKey: string; readonly sectionId: string } | null;
} {
  const {
    documentGenerationRef,
    itemCacheKeysRef,
    loaderRef,
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
        isReviewEstimateCacheKey(projected.cacheKey) ||
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
   * Zed pending_scroll：正文表面已有 item（含 content 的 estimate 头）即可定位；
   * 不再等 document loaded 才滚。meta 槽不进表面 → 无 target → 终端结束。
   */
  const currentScrollTarget = useCallback(
    (navigation: PendingReviewNavigation) => {
      const projected = currentProjectedTarget(navigation);
      if (
        projected !== null &&
        !isReviewPlaceholderCacheKey(projected.cacheKey)
      ) {
        return projected;
      }
      return currentLoadedTarget(navigation);
    },
    [currentLoadedTarget, currentProjectedTarget]
  );

  return {
    currentLoadedTarget,
    currentScrollTarget,
  };
}
