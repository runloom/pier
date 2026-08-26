import type { PierDiffViewHandle } from "@pier/ui/diff-view/index.tsx";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import type { ReviewDocumentProjection } from "../review/document/projection.ts";
import { isReviewPlaceholderCacheKey } from "../review/navigation.ts";
import type { GitReviewReadingSurface } from "../review/reading-surface.ts";
import type { ReviewSurfaceNavigationRequest } from "../review/surface-types.ts";
import { TREE_NAV_SCROLL_BEHAVIOR } from "./use-navigation-try.ts";

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
  const settledNavigationNonceRef = useRef(0);

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

  // pending 卡住时安全超时强制 settle；行级 reveal 不走这条（可能仍是 estimate）
  useEffect(() => {
    if (
      !active ||
      navigationRequest === null ||
      navigationRequest.surface !== diffBase ||
      handledNavigationNonceRef.current !== navigationRequest.nonce ||
      settledNavigationNonceRef.current === navigationRequest.nonce
    ) {
      return;
    }
    if (!(navigationPending || hasPendingNavigation())) {
      return;
    }
    const request = navigationRequest;
    const timer = globalThis.setTimeout(() => {
      if (settledNavigationNonceRef.current === request.nonce) {
        return;
      }
      settledNavigationNonceRef.current = request.nonce;
      const handle = diffHandleRef.current;
      if (handle?.isItemVisible(request.itemId) === true) {
        revealNavigationLine(handle, request);
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

  // 评论行级 reveal 必须在 paint 前（layout），否则 instant 会先画出文件头再跳行。
  // 等 pending 状态变 false 的那次 render（tryPending 的 finish 会触发），不要用
  // 事后 useEffect，否则会多画出一帧顶对齐。
  useLayoutEffect(() => {
    if (
      !active ||
      navigationRequest === null ||
      navigationRequest.surface !== diffBase ||
      handledNavigationNonceRef.current !== navigationRequest.nonce ||
      settledNavigationNonceRef.current === navigationRequest.nonce
    ) {
      return;
    }
    if (navigationPending || hasPendingNavigation()) {
      return;
    }
    settledNavigationNonceRef.current = navigationRequest.nonce;
    revealNavigationLine(diffHandleRef.current, navigationRequest);
    onSurfaceNavigationSettled(navigationRequest);
  }, [
    active,
    diffBase,
    diffHandleRef,
    hasPendingNavigation,
    navigationPending,
    navigationRequest,
    onSurfaceNavigationSettled,
  ]);
}

/** 评论 target.side（"old"|"new"）→ diff-view side（"deletions"|"additions"）。 */
function mapRevealSide(
  side: "new" | "old" | undefined
): "additions" | "deletions" {
  return side === "old" ? "deletions" : "additions";
}

function revealNavigationLine(
  handle: PierDiffViewHandle | null,
  request: ReviewSurfaceNavigationRequest
): void {
  if (request.revealLine === undefined || handle === null) {
    return;
  }
  handle.scrollToLine(
    request.itemId,
    request.revealLine,
    mapRevealSide(request.revealSide),
    { behavior: TREE_NAV_SCROLL_BEHAVIOR }
  );
}
