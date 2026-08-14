import type { PierDiffViewHandle } from "@pier/ui/diff-view/index.tsx";
import type { RefObject } from "react";
import type { ReviewNavigationMemberReason } from "../review/document/demand.ts";
import type { GitReviewDocumentLoader } from "../review/document/loader.ts";
import {
  isReviewEstimateCacheKey,
  isReviewNavigationTerminal,
  type PendingReviewNavigation,
} from "../review/navigation.ts";

/** 树导航只提交一次定位意图；正文 ready 后同步定位，不做动画后纠正。 */
export const TREE_NAV_SCROLL_BEHAVIOR = "instant" as const;
export function tryGitReviewPendingNavigation(options: {
  readonly currentLoadedTarget: (
    navigation: PendingReviewNavigation
  ) => { readonly cacheKey: string; readonly sectionId: string } | null;
  readonly currentScrollTarget: (
    navigation: PendingReviewNavigation
  ) => { readonly cacheKey: string; readonly sectionId: string } | null;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly finishTerminal: () => void;
  readonly acknowledgedTargetWindowRevisionRef: RefObject<number>;
  readonly lastScrolledCacheKeyRef: RefObject<string | null>;
  readonly lastScrolledLayoutKeyRef: RefObject<string | null>;
  readonly lastScrolledProjectionRevisionRef: RefObject<number>;
  readonly lastScrolledSectionRef: RefObject<string | null>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly navigationMemberReasonRef: RefObject<ReviewNavigationMemberReason | null>;
  readonly pendingNavigationRef: RefObject<PendingReviewNavigation | null>;
  readonly projectionRevisionRef: RefObject<number>;
  readonly requiredRenderWindowRevisionRef: RefObject<number>;
  readonly scheduleVerification: () => void;
  readonly viewportLayoutSettledRef: RefObject<boolean>;
}): void {
  const {
    acknowledgedTargetWindowRevisionRef,
    currentLoadedTarget,
    currentScrollTarget,
    diffHandleRef,
    finishTerminal,
    lastScrolledCacheKeyRef,
    lastScrolledLayoutKeyRef,
    lastScrolledProjectionRevisionRef,
    lastScrolledSectionRef,
    loaderRef,
    navigationMemberReasonRef,
    pendingNavigationRef,
    projectionRevisionRef,
    requiredRenderWindowRevisionRef,
    scheduleVerification,
    viewportLayoutSettledRef,
  } = options;

  const navigation = pendingNavigationRef.current;
  if (!navigation) {
    return;
  }
  const target = currentScrollTarget(navigation);
  if (!target) {
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
    return;
  }
  // Dockview 会保留隐藏标签页中的 CodeView 实例，但其容器此时为 0×0。
  // 必须等待真实布局恢复后再提交 scrollTo；否则 Pierre 会接受定位意图，
  // 随后的可见布局却按旧虚拟窗口重排，造成“切回后选中项跳走”。
  if (diffHandleRef.current?.isViewportReady() === false) {
    scheduleVerification();
    return;
  }

  const alreadyScrolledTarget =
    lastScrolledSectionRef.current === target.sectionId &&
    lastScrolledCacheKeyRef.current === target.cacheKey;

  // 每个内容版本只提交一次定位。Pierre 会让 pendingScrollTarget 跟随
  // 后续测量修正；每帧重复 scrollTo 反而会持续重置它的收敛过程。
  if (alreadyScrolledTarget) {
    // Intent 可以打在 estimate 上；Commit 必须等目标离开骨架。
    // 不挂 loader.settled 大门闩，但骨架头可见 ≠ 导航成功。
    if (isReviewEstimateCacheKey(target.cacheKey)) {
      return;
    }
    const targetVisible =
      diffHandleRef.current?.isItemVisible(
        target.sectionId,
        target.cacheKey
      ) === true;
    if (targetVisible && viewportLayoutSettledRef.current) {
      const windowAcknowledged =
        acknowledgedTargetWindowRevisionRef.current >=
        requiredRenderWindowRevisionRef.current;
      if (windowAcknowledged) {
        finishTerminal();
        return;
      }
    }
    return;
  }

  // 先记录意图再调用外部 handle：测试适配器和 Pierre 都可能在
  // scrollTo 内同步回报 render window，必须避免重入时重复提交。
  viewportLayoutSettledRef.current = false;
  lastScrolledSectionRef.current = target.sectionId;
  lastScrolledCacheKeyRef.current = target.cacheKey;
  lastScrolledProjectionRevisionRef.current = projectionRevisionRef.current;
  lastScrolledLayoutKeyRef.current =
    diffHandleRef.current?.getViewportLayoutKey(target.sectionId) ?? null;
  const scrolled =
    diffHandleRef.current?.scrollToItem(target.sectionId, {
      behavior: TREE_NAV_SCROLL_BEHAVIOR,
      // 被动恢复只把已有布局对回选中项，不改折叠态：展开会放大布局变动，
      // 而恢复正是由布局变动（渲染窗口上报）触发的，两者会互相喂食。
      expandCollapsed: navigationMemberReasonRef.current !== "restore",
      ...(navigation.anchorOffset === undefined
        ? {}
        : { offset: navigation.anchorOffset }),
    }) === true;
  if (!scrolled) {
    lastScrolledSectionRef.current = null;
    lastScrolledCacheKeyRef.current = null;
    lastScrolledProjectionRevisionRef.current = -1;
    lastScrolledLayoutKeyRef.current = null;
    return;
  }

  scheduleVerification();
}
