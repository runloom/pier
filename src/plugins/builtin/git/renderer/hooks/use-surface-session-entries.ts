import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import { useMemo, useRef } from "react";
import { reviewGroupsForSurface } from "../review/surface-group.ts";
import type { ReviewSurfaceProps } from "../review/surface-types.ts";

/**
 * 按 surface 过滤 entry，并在 mutation 冻结期保留切换前成员。
 * 非活动 surface 若正在准备导航目标，仍允许刷新成员。
 */
export function useGitReviewSurfaceSessionEntries(options: {
  readonly active: boolean;
  readonly diffBase: ReviewSurfaceProps["diffBase"];
  readonly entries: readonly GitReviewIndexEntry[];
  readonly mutationAuthorityBlocked: boolean;
  readonly navigationRequest: ReviewSurfaceProps["navigationRequest"];
}): {
  readonly renderUpdatesActive: boolean;
  readonly sessionEntries: readonly GitReviewIndexEntry[];
  readonly surfaceEntries: readonly GitReviewIndexEntry[];
} {
  const {
    active,
    diffBase,
    entries,
    mutationAuthorityBlocked,
    navigationRequest,
  } = options;
  const surfaceEntries = useMemo(
    () =>
      entries.filter((entry) =>
        entry.renderSlots.some((slot) =>
          reviewGroupsForSurface(diffBase).includes(slot.group)
        )
      ),
    [diffBase, entries]
  );
  const freezeSourceMembership = active && mutationAuthorityBlocked;
  const preparingNavigationTarget =
    !active &&
    navigationRequest !== null &&
    navigationRequest.surface === diffBase;
  const retainedSurfaceEntriesRef = useRef(surfaceEntries);
  const refreshSurfaceMembership =
    (active && !freezeSourceMembership) || preparingNavigationTarget;
  if (refreshSurfaceMembership) {
    retainedSurfaceEntriesRef.current = surfaceEntries;
  }
  const sessionEntries = refreshSurfaceMembership
    ? surfaceEntries
    : retainedSurfaceEntriesRef.current;
  return {
    renderUpdatesActive: active && !freezeSourceMembership,
    sessionEntries,
    surfaceEntries,
  };
}
