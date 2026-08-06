import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "@pier/ui/diff-view/index.tsx";
import { InlineReviewThreadCard } from "@pier/ui/diff-view/index.tsx";
import type { ReactNode } from "react";

interface ReviewDriftPanelComments {
  readonly driftThread: PierInlineReviewThread | null;
  readonly inlineReviewHandlers: PierInlineReviewHandlers;
  readonly inlineReviewLabels: PierInlineReviewLabels;
}

/**
 * 漂移评论浮层（drift 兜底入口）。
 *
 * 漂移评论 chip 点击 → `openDriftThread` 设当前 drift 线程（再点同一 chip
 * 收起）。本浮层复用 `InlineReviewThreadCard` 渲染（写操作复用行内 handlers；
 * 卡片无关闭按钮，收起靠 chip toggle 或删除）。`driftThread === null` 时不渲染。
 *
 * 锚定策略 v1：浮在 review 面板右上（absolute），不精确锚定到行（对齐旧
 * `ReviewThreadPanel`）。精确行锚定留优化。
 */
export function ReviewDriftPanel({
  comments,
}: {
  readonly comments: ReviewDriftPanelComments;
}): ReactNode {
  const { driftThread, inlineReviewHandlers, inlineReviewLabels } = comments;
  if (driftThread === null) {
    return null;
  }
  return (
    <div className="absolute top-4 right-4 z-30 w-96">
      <InlineReviewThreadCard
        handlers={inlineReviewHandlers}
        labels={inlineReviewLabels}
        thread={driftThread}
      />
    </div>
  );
}
