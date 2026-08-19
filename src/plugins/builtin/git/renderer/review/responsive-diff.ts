import type { ReviewViewOptions } from "./document/ui-state.ts";

export const GIT_REVIEW_RESPONSIVE_INLINE_ENTER_PX = 900;
export const GIT_REVIEW_RESPONSIVE_SPLIT_RESTORE_PX = 960;

export function resolveResponsiveDiffStyle({
  preferredDiffStyle,
  contentWidthPx,
  responsiveUnified,
}: {
  readonly preferredDiffStyle: ReviewViewOptions["diffStyle"];
  readonly contentWidthPx: number | null;
  readonly responsiveUnified: boolean;
}): {
  readonly effectiveDiffStyle: ReviewViewOptions["diffStyle"];
  readonly responsiveUnified: boolean;
} {
  if (preferredDiffStyle === "unified") {
    return { effectiveDiffStyle: "unified", responsiveUnified: false };
  }
  // 0 / NaN 是布局未完成，不能当成「进入窄屏 unified」，否则 hysteresis
  // 会一直等到真正宽度 ≥ 960 才恢复。
  if (
    contentWidthPx === null ||
    !Number.isFinite(contentWidthPx) ||
    contentWidthPx <= 0
  ) {
    return {
      effectiveDiffStyle: responsiveUnified ? "unified" : "split",
      responsiveUnified,
    };
  }
  const nextResponsiveUnified = responsiveUnified
    ? contentWidthPx < GIT_REVIEW_RESPONSIVE_SPLIT_RESTORE_PX
    : contentWidthPx < GIT_REVIEW_RESPONSIVE_INLINE_ENTER_PX;
  return {
    effectiveDiffStyle: nextResponsiveUnified ? "unified" : "split",
    responsiveUnified: nextResponsiveUnified,
  };
}
