import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import { type RefObject, useCallback } from "react";
import type { GitReviewDocumentLoader } from "../review/document/loader.ts";
import { reviewTreeSectionKeyForSurface } from "../review/document/projection-index.ts";
import type { GitReviewReadingSurface } from "../review/reading-surface.ts";

/**
 * retry 失败 entry：定位树节点 + 触发导航。
 *
 * scroll 由 navigationPending layout 接管（子 apply 之后），此处只选中 + begin。
 */
export function useGitReviewRetryFailure({
  beginNavigation,
  diffBase,
  entries,
  entryKeyBySectionIdRef,
  firstSectionIdByEntryKeyRef,
  loaderRef,
  selectedSectionKey,
  sessionEntries,
  setSelectedTreeTarget,
}: {
  readonly beginNavigation: (target: {
    readonly entryKey: string;
    readonly sectionKey: string;
  }) => void;
  readonly diffBase: GitReviewReadingSurface;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly firstSectionIdByEntryKeyRef: RefObject<ReadonlyMap<string, string>>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly selectedSectionKey: string | null;
  readonly sessionEntries: readonly GitReviewIndexEntry[];
  readonly setSelectedTreeTarget: (
    target: {
      readonly entryKey: string;
      readonly sectionKey: string;
    } | null
  ) => void;
}): (entryKey: string) => void {
  // refs 是稳定容器（RefObject 参数），.current 读取不进依赖；deps 覆盖反应式值。
  // biome-ignore lint/correctness/useExhaustiveDependencies: ref params are stable containers
  return useCallback(
    (entryKey: string) => {
      loaderRef.current?.retry(entryKey);
      const retryEntry =
        entries.find((entry) => entry.entryKey === entryKey) ??
        sessionEntries.find((entry) => entry.entryKey === entryKey);
      let treeSectionKey: string | null = null;
      if (
        selectedSectionKey &&
        entryKeyBySectionIdRef.current.get(selectedSectionKey) === entryKey
      ) {
        treeSectionKey = selectedSectionKey;
      } else if (retryEntry) {
        treeSectionKey = reviewTreeSectionKeyForSurface(retryEntry, diffBase);
      }
      const itemId = firstSectionIdByEntryKeyRef.current.get(entryKey);
      if (!(treeSectionKey && itemId)) {
        return;
      }
      setSelectedTreeTarget({ entryKey, sectionKey: treeSectionKey });
      // scroll 由 navigationPending layout 触发（子 apply 之后）
      beginNavigation({ entryKey, sectionKey: itemId });
    },
    [
      beginNavigation,
      diffBase,
      entries,
      selectedSectionKey,
      setSelectedTreeTarget,
      sessionEntries,
    ]
  );
}
