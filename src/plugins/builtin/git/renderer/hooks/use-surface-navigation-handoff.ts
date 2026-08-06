import type { PierDiffViewHandle } from "@pier/ui/diff-view/index.tsx";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import type { ReviewDocumentProjection } from "../review/document/projection.ts";
import { isReviewPlaceholderCacheKey } from "../review/navigation.ts";
import type { GitReviewReadingSurface } from "../review/reading-surface.ts";
import type { ReviewSurfaceNavigationRequest } from "../review/surface-types.ts";

/**
 * Cross-surface tree open 契约（金标准）：
 * - 树点击：`requestTreeOpen` **立即** setActiveSurface；本 hook 在 **active 面**
 *   上 `beginNavigation`（demand + scroll）
 * - materialize 仅兜底 inactive 面（如 mutation preserve）；**不是** 树 activate 切面门闩
 * - settle：pending 结束后清 navigationRequest；超时强制 settle 防卡死
 */
/** pending scroll 卡住时仍清 navigationRequest 的安全上限 */
const NAVIGATION_SETTLE_SAFETY_MS = 1200;

export function useGitReviewSurfaceNavigationHandoff(options: {
  readonly active: boolean;
  readonly applyNavigationDemand: (entryKey: string) => void;
  readonly beginNavigation: (target: {
    readonly anchorOffset?: number;
    readonly entryKey: string;
    readonly sectionKey: string;
  }) => void;
  readonly diffBase: GitReviewReadingSurface;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
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
    diffHandleRef,
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

  // pending 结束后 settle；若 scroll 卡住则安全超时强制 settle
  useEffect(() => {
    if (
      !active ||
      navigationRequest === null ||
      navigationRequest.surface !== diffBase ||
      handledNavigationNonceRef.current !== navigationRequest.nonce
    ) {
      return;
    }
    if (!(navigationPending || hasPendingNavigation())) {
      if (navigationRequest.revealLine !== undefined) {
        diffHandleRef.current?.scrollToLine(
          navigationRequest.itemId,
          navigationRequest.revealLine,
          mapRevealSide(navigationRequest.revealSide)
        );
      }
      onSurfaceNavigationSettled(navigationRequest);
      return;
    }
    const request = navigationRequest;
    const timer = globalThis.setTimeout(() => {
      // Still attempt line reveal on safety timeout (slow materialize).
      if (request.revealLine !== undefined) {
        diffHandleRef.current?.scrollToLine(
          request.itemId,
          request.revealLine,
          mapRevealSide(request.revealSide)
        );
      }
      onSurfaceNavigationSettled(request);
    }, NAVIGATION_SETTLE_SAFETY_MS);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [
    active,
    diffBase,
    diffHandleRef,
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
    // 兜底路径（面仍 inactive 时）：账本有成员即可 materialize 切面（含 estimate）。
    // 树 activate 主路径不依赖本 effect（已在 requestTreeOpen 切面）。
    if (target === undefined || isReviewPlaceholderCacheKey(target.cacheKey)) {
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

/** 评论 target.side（"old"|"new"）→ diff-view side（"deletions"|"additions"）。 */
function mapRevealSide(
  side: "new" | "old" | undefined
): "additions" | "deletions" {
  return side === "old" ? "deletions" : "additions";
}
