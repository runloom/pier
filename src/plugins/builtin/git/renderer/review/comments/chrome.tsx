import type { PierDiffViewHandle } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { CommentThread } from "@shared/contracts/comments/base.ts";
import type {
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import type { ComponentProps, JSX, RefObject } from "react";
import type { GitReviewReadingSurface } from "../reading-surface.ts";
import type { ReviewTreeOpenReveal } from "../surface-types.ts";
import { ReviewDriftPanel } from "./drift-panel.tsx";
import { ReviewCommentNavigatorHost } from "./navigator-host.tsx";

/** Diff 评论叠加层：漂移浮层 + 底部导航条。 */
export function ReviewCommentsChrome(props: {
  readonly collidingFileLabel?: (name: string) => string;
  readonly comments: ComponentProps<typeof ReviewDriftPanel>["comments"];
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
}): JSX.Element {
  return (
    <>
      <ReviewDriftPanel comments={props.comments} />
      <ReviewCommentNavigatorHost
        collidingFileLabel={props.collidingFileLabel}
        context={props.context}
        diffBase={props.diffBase}
        diffHandleRef={props.diffHandleRef}
        entries={props.entries}
        onRequestTreeOpen={props.onRequestTreeOpen}
        threads={props.threads}
        worktreeKey={props.worktreeKey}
      />
    </>
  );
}
