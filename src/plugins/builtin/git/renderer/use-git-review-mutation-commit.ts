import type { GitReviewMutationOk } from "@shared/contracts/git-review.ts";
import { useCallback } from "react";
import type { GitReviewMutationTransition } from "./git-review-reading-surface.ts";

/**
 * Mutation ack 只确认写入完成，不携带或提交 UI 状态。
 * 无防抖 `refreshNow` 是用户写入的提交屏障；仓库 watch 只合并外部变化。
 */
export function useGitReviewMutationCommit(
  waitForAuthoritativeState: (
    result: GitReviewMutationOk | null
  ) => Promise<void>,
  requestTransition: (transition: GitReviewMutationTransition) => void
): (
  result: GitReviewMutationOk | null,
  transition?: GitReviewMutationTransition
) => Promise<void> {
  return useCallback(
    async (
      result: GitReviewMutationOk | null,
      transition?: GitReviewMutationTransition
    ) => {
      if (result !== null && transition !== undefined) {
        requestTransition(transition);
      }
      await waitForAuthoritativeState(result);
    },
    [requestTransition, waitForAuthoritativeState]
  );
}
