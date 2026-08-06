/**
 * Drift 评论 cache key 派生（从 items.ts 抽离，控文件行数）。
 *
 * drift 是 item 固有数据（非激活态），driftComments 变化必须触发 re-parse
 * 重建 drift annotation。`itemCacheKeyOf` 把 drift 指纹拼进 cacheKey，drift
 * 变化时 cache 不命中 → re-parse → drift annotation 重建。processFile 的
 * hunk 解析缓存仍用 `input.cacheKey`（不含评论，不受 drift 影响）。
 *
 * 同理 `reviewComments` 也进 base annotations（review-thread 行内卡），其指纹
 * 一并拼进 cacheKey，评论新增/删除 → cache 不命中 → re-parse 重建
 * review-thread annotation。v1 瘦身：指纹不含 state/count。
 */
import type {
  PierDiffReviewCommentThread,
  PierDiffReviewDriftThread,
  PierDiffViewItem,
} from "../items.ts";

export function driftKeyOf(
  driftComments: readonly PierDiffReviewDriftThread[] | undefined
): string {
  if (driftComments === undefined || driftComments.length === 0) {
    return "";
  }
  return driftComments
    .map(
      (thread) => `${thread.threadId}:${thread.line ?? 0}:${thread.side ?? ""}`
    )
    .join(",");
}

export function reviewCommentsKeyOf(
  comments: readonly PierDiffReviewCommentThread[] | undefined
): string {
  if (comments === undefined || comments.length === 0) {
    return "";
  }
  return comments
    .map((thread) => `${thread.threadId}:${thread.side}:${thread.line}`)
    .join(",");
}

export function itemCacheKeyOf(input: PierDiffViewItem): string {
  const parts = [input.cacheKey];
  const driftKey = driftKeyOf(input.driftComments);
  if (driftKey.length !== 0) {
    parts.push(`drift=${driftKey}`);
  }
  const reviewKey = reviewCommentsKeyOf(input.reviewComments);
  if (reviewKey.length !== 0) {
    parts.push(`review=${reviewKey}`);
  }
  return parts.join("#");
}
