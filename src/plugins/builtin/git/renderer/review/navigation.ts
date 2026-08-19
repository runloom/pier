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
