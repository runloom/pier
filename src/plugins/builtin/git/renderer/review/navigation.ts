import { isReviewSlotIncludedInBody } from "./document/body-class.ts";
import type { GitReviewDocumentResource } from "./document/resource.ts";

export interface PendingReviewNavigation {
  readonly anchorOffset?: number;
  readonly entryKey: string;
  readonly generation: number;
  readonly sectionKey: string;
}

interface ReviewNavigationTarget {
  readonly cacheKey: string;
  readonly sectionId: string;
}

function entryHasReviewSection(
  resource: GitReviewDocumentResource,
  sectionKey: string
): boolean {
  return resource.entry.renderSlots.some(
    (slot) => slot.sectionKey === sectionKey
  );
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

export function isReviewPlaceholderCacheKey(
  cacheKey: string | undefined
): boolean {
  // 历史假 placeholder cacheKey 不再产生；undefined 仍视为非 scroll 目标。
  return cacheKey === undefined;
}

/** estimate 是稳定账本成员，但不代表真实正文已经提交给 CodeView。 */
export function isReviewEstimateCacheKey(
  cacheKey: string | undefined
): boolean {
  return cacheKey?.startsWith("estimate:") === true;
}

export function findReviewNavigationTarget(
  resource: GitReviewDocumentResource | undefined,
  projectedCacheKeys: ReadonlyMap<string, string>,
  sectionKey?: string
): ReviewNavigationTarget | null {
  if (!isReviewNavigationContentReady(resource)) {
    return null;
  }
  const sectionId =
    sectionKey ?? resource.entry.renderSlots[0]?.sectionKey ?? null;
  if (sectionId === null || !entryHasReviewSection(resource, sectionId)) {
    return null;
  }
  const cacheKey = projectedCacheKeys.get(sectionId);
  return cacheKey === undefined || isReviewPlaceholderCacheKey(cacheKey)
    ? null
    : { cacheKey, sectionId };
}

export function isReviewNavigationTerminal(
  resource: GitReviewDocumentResource | undefined,
  settled: boolean,
  sectionKey?: string
): boolean {
  // meta 不进正文 → 导航立即终态（不假 scroll）。notice 已在列表里，继续滚。
  if (resource !== undefined) {
    const slot =
      sectionKey === undefined
        ? resource.entry.renderSlots[0]
        : resource.entry.renderSlots.find(
            (candidate) => candidate.sectionKey === sectionKey
          );
    if (slot !== undefined && !isReviewSlotIncludedInBody(slot)) {
      return true;
    }
  }
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
    !entryHasReviewSection(resource, sectionKey)
  ) {
    return true;
  }
  return false;
}

export interface ReviewRevealProgress {
  readonly cacheKey: string;
  readonly contentCommits: number;
  readonly geometryCorrections: number;
  readonly projectionRevision: number;
  readonly scrollCount: number;
  readonly sectionId: string;
}

export type ReviewRevealPlan =
  | { readonly kind: "scroll-intent" }
  | {
      readonly kind: "scroll-content";
      readonly progress: ReviewRevealProgress;
    }
  | {
      readonly kind: "scroll-geometry";
      readonly progress: ReviewRevealProgress;
    }
  | { readonly kind: "settle" }
  | { readonly kind: "wait" };

export interface ReviewRevealInput {
  readonly expectedViewportOffset: number;
  readonly isEstimate: boolean;
  readonly progress: ReviewRevealProgress | null;
  readonly projectionRevision: number;
  readonly target: {
    readonly cacheKey: string;
    readonly sectionId: string;
  } | null;
  readonly targetVisible: boolean;
  readonly viewportOffset: number | null;
  readonly viewportReady: boolean;
  readonly viewportSettled: boolean;
  readonly windowAcknowledged: boolean;
}

export const MAX_REVIEW_REVEAL_SCROLLS = 4;
export const MAX_REVIEW_REVEAL_GEOMETRY_CORRECTIONS = 2;
export const MAX_REVIEW_REVEAL_CONTENT_COMMITS = 1;
export const REVIEW_REVEAL_OFFSET_TOLERANCE_PX = 1;

/** 只读探针：测试 / E2E 读，不参与导航决策、不产生产品 UI。 */
export interface ReviewRevealProbe {
  readonly contentCommitCount: number;
  readonly geometryCorrectionCount: number;
  readonly scrollIntentCount: number;
  readonly scrollToCount: number;
}

export function readReviewRevealProbe(
  progress: ReviewRevealProgress | null
): ReviewRevealProbe {
  return {
    contentCommitCount: progress?.contentCommits ?? 0,
    geometryCorrectionCount: progress?.geometryCorrections ?? 0,
    scrollIntentCount: progress === null ? 0 : 1,
    scrollToCount: progress?.scrollCount ?? 0,
  };
}

function hasRevealScrollBudget(progress: ReviewRevealProgress): boolean {
  return (
    progress.scrollCount < MAX_REVIEW_REVEAL_SCROLLS &&
    progress.geometryCorrections < MAX_REVIEW_REVEAL_GEOMETRY_CORRECTIONS
  );
}

export function planReviewReveal(input: ReviewRevealInput): ReviewRevealPlan {
  if (!(input.viewportReady && input.target !== null)) {
    return { kind: "wait" };
  }
  const { progress, target } = input;
  if (progress === null || progress.sectionId !== target.sectionId) {
    return { kind: "scroll-intent" };
  }
  if (progress.cacheKey !== target.cacheKey) {
    if (input.isEstimate) {
      return { kind: "wait" };
    }
    // 同一导航代次只允许一次正文提交；再次换 cacheKey 时必须等布局
    // 自己稳定，不能把正文提交变成无限重试。
    if (progress.contentCommits >= MAX_REVIEW_REVEAL_CONTENT_COMMITS) {
      return input.viewportSettled ? { kind: "settle" } : { kind: "wait" };
    }
    if (progress.scrollCount >= MAX_REVIEW_REVEAL_SCROLLS) {
      return input.viewportSettled ? { kind: "settle" } : { kind: "wait" };
    }
    return {
      kind: "scroll-content",
      progress: {
        ...progress,
        cacheKey: target.cacheKey,
        contentCommits: progress.contentCommits + 1,
        projectionRevision: input.projectionRevision,
        scrollCount: progress.scrollCount + 1,
      },
    };
  }
  if (input.isEstimate) {
    return { kind: "wait" };
  }
  if (!input.viewportSettled) {
    return { kind: "wait" };
  }
  const drift =
    input.viewportOffset === null
      ? !input.targetVisible
      : Math.abs(input.viewportOffset - input.expectedViewportOffset) >
        REVIEW_REVEAL_OFFSET_TOLERANCE_PX;
  if (drift && hasRevealScrollBudget(progress)) {
    return {
      kind: "scroll-geometry",
      progress: {
        ...progress,
        geometryCorrections: progress.geometryCorrections + 1,
        projectionRevision: input.projectionRevision,
        scrollCount: progress.scrollCount + 1,
      },
    };
  }
  if (input.targetVisible && input.windowAcknowledged) {
    return { kind: "settle" };
  }
  if (
    progress.geometryCorrections >= MAX_REVIEW_REVEAL_GEOMETRY_CORRECTIONS ||
    progress.scrollCount >= MAX_REVIEW_REVEAL_SCROLLS
  ) {
    return { kind: "settle" };
  }
  return { kind: "wait" };
}
