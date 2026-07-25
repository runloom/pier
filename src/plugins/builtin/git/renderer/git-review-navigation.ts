import type { GitReviewDocumentResource } from "./git-review-document-resource.ts";

const NAVIGATION_TIMEOUT_MS = 4000;
const NAVIGATION_MAX_ATTEMPTS = 120;

export interface PendingReviewNavigation {
  readonly entryKey: string;
  readonly generation: number;
  readonly sectionKey: string;
}

interface ReviewNavigationTarget {
  readonly cacheKey: string;
  readonly sectionId: string;
}

export function reviewNavigationKey(
  navigation: PendingReviewNavigation
): string {
  return JSON.stringify([
    navigation.entryKey,
    navigation.sectionKey,
    navigation.generation,
  ]);
}

/**
 * 导航成功只接受已进 CodeView 的真成员（loaded 正文；error 说明）。
 * 未 materialize 的 entry 不在列表——对齐 DiffsHub：内容就绪后再 scroll。
 */
export function isReviewNavigationContentReady(
  resource: GitReviewDocumentResource | undefined
): resource is Extract<
  GitReviewDocumentResource,
  { kind: "loaded" | "error" }
> {
  return resource?.kind === "loaded" || resource?.kind === "error";
}

/**
 * 历史 placeholder cacheKey 或未投影 id：禁止作为 scroll 目标。
 * 终态投影不再产生 git-review-placeholder: 前缀。
 */
export function isReviewPlaceholderCacheKey(
  cacheKey: string | undefined
): boolean {
  return (
    cacheKey === undefined || cacheKey.startsWith("git-review-placeholder:")
  );
}

/**
 * 允许 scroll：loader 已 loaded/error 且投影已有该 section 的真 cacheKey。
 */
export function shouldScrollReviewNavigation(options: {
  readonly projectedCacheKey: string | undefined;
  readonly resource: GitReviewDocumentResource | undefined;
}): boolean {
  if (isReviewPlaceholderCacheKey(options.projectedCacheKey)) {
    return false;
  }
  return isReviewNavigationContentReady(options.resource);
}

export function findReviewNavigationTarget(
  resource: GitReviewDocumentResource | undefined,
  projectedCacheKeys: ReadonlyMap<string, string>,
  sectionKey?: string
): ReviewNavigationTarget | null {
  if (!isReviewNavigationContentReady(resource)) {
    return null;
  }
  if (sectionKey !== undefined) {
    if (resource.kind === "loaded") {
      if (
        !resource.document.sections.some(
          (candidate) => candidate.sectionKey === sectionKey
        )
      ) {
        return null;
      }
    } else if (
      !resource.entry.renderSlots.some((slot) => slot.sectionKey === sectionKey)
    ) {
      return null;
    }
    const cacheKey = projectedCacheKeys.get(sectionKey);
    return cacheKey === undefined || isReviewPlaceholderCacheKey(cacheKey)
      ? null
      : { cacheKey, sectionId: sectionKey };
  }
  if (resource.kind === "loaded") {
    const section = resource.document.sections.find((candidate) =>
      projectedCacheKeys.has(candidate.sectionKey)
    );
    if (!section) {
      return null;
    }
    const cacheKey = projectedCacheKeys.get(section.sectionKey);
    return cacheKey === undefined || isReviewPlaceholderCacheKey(cacheKey)
      ? null
      : { cacheKey, sectionId: section.sectionKey };
  }
  const slot = resource.entry.renderSlots.find((candidate) =>
    projectedCacheKeys.has(candidate.sectionKey)
  );
  if (!slot) {
    return null;
  }
  const cacheKey = projectedCacheKeys.get(slot.sectionKey);
  return cacheKey === undefined || isReviewPlaceholderCacheKey(cacheKey)
    ? null
    : { cacheKey, sectionId: slot.sectionKey };
}

export function isReviewNavigationTerminal(
  resource: GitReviewDocumentResource | undefined,
  settled: boolean
): boolean {
  return (
    resource?.kind === "error" ||
    resource?.kind === "unchanged" ||
    (resource === undefined && settled)
  );
}

interface ReviewNavigationVerificationOptions {
  readonly getSectionId: () => string | undefined;
  readonly isCurrent: () => boolean;
  readonly isTerminal: () => boolean;
  readonly isVisible: (sectionId: string) => boolean;
  readonly onTerminal: () => void;
  readonly onTimeout: () => void;
  readonly onVisible: () => void;
  readonly scrollToItem: (sectionId: string) => boolean;
}

/**
 * Pierre 的 scrollTo 会在自己的动画帧中兑现。这里连续等待两个帧边界后再检查
 * 真实可见性；首轮未命中时有界重发定位，直到成功、资源终态或截止时间。
 */
export function scheduleReviewNavigationVerification({
  getSectionId,
  isCurrent,
  isTerminal,
  isVisible,
  onTerminal,
  onTimeout,
  onVisible,
  scrollToItem,
}: ReviewNavigationVerificationOptions): () => void {
  const deadline = performance.now() + NAVIGATION_TIMEOUT_MS;
  let attempts = 0;
  let cancelled = false;
  let firstFrame: number | null = null;
  let secondFrame: number | null = null;

  const cancel = (): void => {
    cancelled = true;
    if (firstFrame !== null) {
      cancelAnimationFrame(firstFrame);
    }
    if (secondFrame !== null) {
      cancelAnimationFrame(secondFrame);
    }
    firstFrame = null;
    secondFrame = null;
  };

  const schedule = (): void => {
    firstFrame = requestAnimationFrame(() => {
      firstFrame = null;
      secondFrame = requestAnimationFrame(() => {
        secondFrame = null;
        if (cancelled || !isCurrent()) {
          return;
        }
        const sectionId = getSectionId();
        if (sectionId && isVisible(sectionId)) {
          onVisible();
          return;
        }
        if (isTerminal()) {
          onTerminal();
          return;
        }
        attempts += 1;
        if (
          attempts >= NAVIGATION_MAX_ATTEMPTS ||
          performance.now() >= deadline
        ) {
          onTimeout();
          return;
        }
        if (sectionId) {
          scrollToItem(sectionId);
        }
        schedule();
      });
    });
  };

  schedule();
  return cancel;
}
