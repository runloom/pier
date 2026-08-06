import type { PierDiffViewHandle } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type {
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import type { JSX, RefObject } from "react";
import { useReviewCommentNavigator } from "../../hooks/use-review-comment-navigator.ts";
import type { GitReviewReadingSurface } from "../reading-surface.ts";
import type { ReviewTreeOpenReveal } from "../surface-types.ts";
import { ReviewCommentNavigator } from "./navigator.tsx";

/** content 装配薄壳：有评论才挂浮动导航条。 */
export function ReviewCommentNavigatorHost(props: {
  readonly context: RendererPluginContext;
  readonly diffBase: GitReviewReadingSurface;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly onRequestTreeOpen: (
    entryKey: string,
    sectionKey: string,
    group: GitReviewGroup,
    reveal?: ReviewTreeOpenReveal
  ) => void;
  readonly threads: readonly CommentThread[] | null;
  readonly worktreeKey: string;
}): JSX.Element | null {
  const navigator = useReviewCommentNavigator(props);
  if (!navigator.visible) {
    return null;
  }
  return (
    <ReviewCommentNavigator
      activeIndex={navigator.activeIndex}
      clearLabel={navigator.clearLabel}
      nextLabel={navigator.nextLabel}
      onClear={navigator.onClear}
      onNext={navigator.onNext}
      onPrevious={navigator.onPrevious}
      positionLabel={navigator.positionLabel}
      previousLabel={navigator.previousLabel}
      toolbarLabel={navigator.toolbarLabel}
      total={navigator.total}
    />
  );
}
