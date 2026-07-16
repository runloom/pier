import type { GitReviewDocumentResource } from "./git-review-document-resource.ts";

const NAVIGATION_TIMEOUT_MS = 4000;
const NAVIGATION_MAX_ATTEMPTS = 120;

export interface PendingReviewNavigation {
  readonly entryKey: string;
  readonly generation: number;
}

interface ReviewNavigationTarget {
  readonly cacheKey: string;
  readonly sectionId: string;
}

export function reviewNavigationKey(
  navigation: PendingReviewNavigation
): string {
  return JSON.stringify([navigation.entryKey, navigation.generation]);
}

/**
 * 导航成功只接受 ready 正文（loaded document 已投影）。
 * loading 占位可见不算完成——对齐 DiffsHub/Cursor：内容就绪后再确认定位。
 */
export function isReviewNavigationContentReady(
  resource: GitReviewDocumentResource | undefined
): resource is Extract<GitReviewDocumentResource, { kind: "loaded" }> {
  return resource?.kind === "loaded";
}

/** loading 占位 cacheKey：允许保留列表身份，但禁止作为导航 scroll 目标。 */
export function isReviewPlaceholderCacheKey(
  cacheKey: string | undefined
): boolean {
  return (
    cacheKey === undefined || cacheKey.startsWith("git-review-placeholder:")
  );
}

/**
 * 允许 scroll 的 ready 内容：
 * - 当前 loader 已 loaded；或
 * - 投影已是非 placeholder（含刷新暂留的上一代 ready 正文）
 * 空占位一律不 scroll。
 */
export function shouldScrollReviewNavigation(options: {
  readonly projectedCacheKey: string | undefined;
  readonly resource: GitReviewDocumentResource | undefined;
}): boolean {
  if (isReviewPlaceholderCacheKey(options.projectedCacheKey)) {
    return false;
  }
  return (
    isReviewNavigationContentReady(options.resource) ||
    options.projectedCacheKey !== undefined
  );
}

export function findReviewNavigationTarget(
  resource: GitReviewDocumentResource | undefined,
  projectedCacheKeys: ReadonlyMap<string, string>
): ReviewNavigationTarget | null {
  if (!isReviewNavigationContentReady(resource)) {
    return null;
  }
  const section = resource.document.sections.find((candidate) =>
    projectedCacheKeys.has(candidate.sectionKey)
  );
  if (!section) {
    return null;
  }
  const cacheKey = projectedCacheKeys.get(section.sectionKey);
  return cacheKey === undefined
    ? null
    : { cacheKey, sectionId: section.sectionKey };
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
