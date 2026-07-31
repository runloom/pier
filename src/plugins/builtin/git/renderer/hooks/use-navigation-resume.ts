import type { RefObject } from "react";
import { resolveReviewSectionKey } from "../review/navigation.ts";

/**
 * projection/layout 后只维护选择身份。
 * 真正的导航始终由 beginNavigation 持有 pending；普通 index/body 刷新不得从 selection
 * 反向合成 scrollTo，否则暂存换组会把阅读视口拉回树选中项。
 */
export function syncGitReviewSelectedSection(options: {
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly firstSectionIdByEntryKeyRef: RefObject<ReadonlyMap<string, string>>;
  readonly selectedEntryKeyRef: RefObject<string | null>;
  readonly selectedSectionKeyRef: {
    current: string | null;
  };
}): void {
  const selected = options.selectedEntryKeyRef.current;
  if (!selected) {
    return;
  }
  const selectedSection = resolveReviewSectionKey({
    entryKey: selected,
    entryKeyBySectionId: options.entryKeyBySectionIdRef.current,
    firstSectionIdByEntryKey: options.firstSectionIdByEntryKeyRef.current,
    preferredSectionKey: options.selectedSectionKeyRef.current,
  });
  if (!selectedSection) {
    return;
  }
  options.selectedSectionKeyRef.current = selectedSection;
}
