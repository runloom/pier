import type { GitReviewDocumentResource } from "./git-review-document-resource.ts";

const NAVIGATION_TIMEOUT_MS = 4000;
/** full-alignment：生产主路径禁止多轮 scrollTo（默认 0）。 */
export const NAVIGATION_MAX_RESCROLL_ATTEMPTS = 0;
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
 * stage 换 group 会换 sectionKey：优先保留仍属该 entry 的 preferred，
 * 否则落到 first section。禁止对已失效 section 武装导航。
 */
export function resolveReviewSectionKey(options: {
  readonly entryKey: string;
  readonly entryKeyBySectionId: ReadonlyMap<string, string>;
  readonly firstSectionIdByEntryKey: ReadonlyMap<string, string>;
  readonly preferredSectionKey: string | null;
}): string | null {
  const preferred = options.preferredSectionKey;
  if (
    preferred !== null &&
    options.entryKeyBySectionId.get(preferred) === options.entryKey
  ) {
    return preferred;
  }
  return options.firstSectionIdByEntryKey.get(options.entryKey) ?? null;
}

/**
 * loader 是否已有可展示正文（loaded/error）。
 * 与「能否 scroll」解耦：账本有 estimate 即可滚（stable-ledger）。
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
 * 历史假 placeholder cacheKey 或未投影 id：禁止作为 scroll 目标。
 * estimate: 前缀合法（全量账本）。
 */
export function isReviewPlaceholderCacheKey(
  cacheKey: string | undefined
): boolean {
  return (
    cacheKey === undefined || cacheKey.startsWith("git-review-placeholder:")
  );
}

/**
 * 允许 scroll：投影已有非历史-placeholder 的 cacheKey（含 estimate）。
 * resource 参数保留兼容；不再要求 loaded。
 */
export function shouldScrollReviewNavigation(options: {
  readonly projectedCacheKey: string | undefined;
  readonly resource?: GitReviewDocumentResource | undefined;
}): boolean {
  return !isReviewPlaceholderCacheKey(options.projectedCacheKey);
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
  settled: boolean,
  sectionKey?: string
): boolean {
  if (resource?.kind === "error" || (resource === undefined && settled)) {
    return true;
  }
  // settled 且目标 section 已不在 entry（stage 换 group 未 rebind）：任何非 loading 态都终态。
  // unchanged 仅在 section 仍属 entry 时不当终态（软保留正文可能仍在 projection）。
  if (
    sectionKey !== undefined &&
    settled &&
    resource !== undefined &&
    resource.kind !== "loading" &&
    resource.kind !== "cancelling" &&
    !resource.entry.renderSlots.some((slot) => slot.sectionKey === sectionKey)
  ) {
    return true;
  }
  return false;
}

interface ReviewNavigationVerificationOptions {
  readonly getSectionId: () => string | undefined;
  readonly isCurrent: () => boolean;
  readonly isTerminal: () => boolean;
  readonly isVisible: (sectionId: string) => boolean;
  /** 默认 0：只观察可见性，不重发 scrollTo（DiffsHub 对齐）。 */
  readonly maxRescrollAttempts?: number;
  readonly onTerminal: () => void;
  readonly onTimeout: () => void;
  readonly onVisible: () => void;
  readonly scrollToItem: (sectionId: string) => boolean;
}

/**
 * 观察 scrollTo 是否落定。主路径 scrollTo 只应在调用方触发一次；
 * 默认 maxRescrollAttempts=0，双 rAF 仅用于 isVisible 观测。
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
  maxRescrollAttempts = NAVIGATION_MAX_RESCROLL_ATTEMPTS,
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
        if (performance.now() >= deadline) {
          onTimeout();
          return;
        }
        if (attempts >= NAVIGATION_MAX_ATTEMPTS) {
          onTimeout();
          return;
        }
        attempts += 1;
        // 主路径 maxRescroll=0：只 poll 可见性。显式放开时才有界补偿 scrollTo。
        if (
          maxRescrollAttempts > 0 &&
          attempts <= maxRescrollAttempts &&
          sectionId
        ) {
          scrollToItem(sectionId);
        }
        schedule();
      });
    });
  };

  schedule();
  return cancel;
}
