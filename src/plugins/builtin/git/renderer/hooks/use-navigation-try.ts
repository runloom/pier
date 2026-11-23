import type { PierDiffViewHandle } from "@pier/ui/diff-view/index.tsx";
import type { RefObject } from "react";
import type { ReviewNavigationMemberReason } from "../review/document/demand.ts";
import type { GitReviewDocumentLoader } from "../review/document/loader.ts";
import {
  isReviewEstimateCacheKey,
  isReviewNavigationTerminal,
  type PendingReviewNavigation,
  planReviewReveal,
  type ReviewRevealProgress,
} from "../review/navigation.ts";

/** 树导航提交定位意图；正文 ready 后提交内容定位，布局结算后允许有界几何修正。 */
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
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly navigationMemberReasonRef: RefObject<ReviewNavigationMemberReason | null>;
  readonly pendingNavigationRef: RefObject<PendingReviewNavigation | null>;
  readonly projectionRevisionRef: RefObject<number>;
  readonly requiredRenderWindowRevisionRef: RefObject<number>;
  readonly revealProgressRef: RefObject<ReviewRevealProgress | null>;
  readonly scheduleVerification: () => void;
  readonly viewportLayoutSettledRef: RefObject<boolean>;
}): void {
  const {
    acknowledgedTargetWindowRevisionRef,
    currentLoadedTarget,
    currentScrollTarget,
    diffHandleRef,
    finishTerminal,
    loaderRef,
    navigationMemberReasonRef,
    pendingNavigationRef,
    projectionRevisionRef,
    requiredRenderWindowRevisionRef,
    revealProgressRef,
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
  const viewportReady = diffHandleRef.current?.isViewportReady() === true;
  if (!viewportReady) {
    scheduleVerification();
    return;
  }

  const targetVisible =
    diffHandleRef.current?.isItemVisible(target.sectionId, target.cacheKey) ===
    true;
  const viewportOffset =
    diffHandleRef.current?.getViewportOffsetForItem(target.sectionId) ?? null;
  const plan = planReviewReveal({
    expectedViewportOffset: navigation.anchorOffset ?? 0,
    isEstimate: isReviewEstimateCacheKey(target.cacheKey),
    progress: revealProgressRef.current,
    projectionRevision: projectionRevisionRef.current,
    target,
    targetVisible,
    viewportOffset,
    viewportReady,
    viewportSettled: viewportLayoutSettledRef.current,
    windowAcknowledged:
      acknowledgedTargetWindowRevisionRef.current >=
      requiredRenderWindowRevisionRef.current,
  });

  if (plan.kind === "wait") {
    // Intent 可以打在 estimate 上；Commit 必须等目标离开骨架。
    // 不挂 loader.settled 大门闩，但骨架头可见 ≠ 导航成功。
    // scheduleVerification 在已 settle 时是 no-op；真正需要新布局信号时
    // （刚提交定位 / 隐藏标签页恢复）才重新挂 waiter，避免 estimate 上忙轮询。
    scheduleVerification();
    return;
  }
  if (plan.kind === "settle") {
    finishTerminal();
    return;
  }

  // 先记录意图再调用外部 handle：测试适配器和 Pierre 都可能在
  // scrollTo 内同步回报 render window，必须避免重入时重复提交。
  viewportLayoutSettledRef.current = false;
  revealProgressRef.current =
    plan.kind === "scroll-intent"
      ? {
          cacheKey: target.cacheKey,
          contentCommits: 0,
          geometryCorrections: 0,
          projectionRevision: projectionRevisionRef.current,
          scrollCount: 1,
          sectionId: target.sectionId,
        }
      : plan.progress;
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
    revealProgressRef.current = null;
    // 同步失败不是终态：重新挂稳定帧等待下一次布局 / 窗口信号，
    // 否则 pending 会停在既无滚动、也无 waiter 的空窗。
    scheduleVerification();
    return;
  }

  scheduleVerification();
}
