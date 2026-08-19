/**
 * Markdown preview comments: hook + drift strip + IR chrome props + navigator.
 */
import { CommentNavigator } from "@pier/ui/comments/navigator.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useCommentNavigatorController,
  useCommentNavigatorLabels,
} from "../../comments/use-comment-navigator.ts";
import { createFilesTranslate } from "../../i18n.ts";
import type { MarkdownIrDocument } from "../ir.ts";
import type { MarkdownPagination } from "../runtime.ts";
import type { MarkdownIrCommentsChrome } from "./ir-types.ts";
import { MarkdownCommentDriftStrip } from "./preview-block.tsx";
import {
  type MarkdownCommentReveal,
  nextMarkdownCommentReveal,
  pageIndexForCommentBlockKey,
  revealMatchesSurface,
  scheduleMarkdownCommentScroll,
} from "./reveal.ts";
import {
  type MarkdownCommentLabels,
  type MarkdownCommentNavTarget,
  useMarkdownPreviewComments,
} from "./use-preview.ts";

export interface MarkdownPreviewCommentLabels {
  addComment: string;
  authorYou: string;
  cancel: string;
  close: string;
  createFailed: string;
  deleteComment: string;
  deleted: string;
  deleteFailed: string;
  driftTitle: string;
  editComment: string;
  inputPlaceholder: string;
  save: string;
  submit: string;
  title: string;
  updateFailed: string;
  viewComment: string;
  viewComments: string;
}

export const DEFAULT_MARKDOWN_COMMENT_LABELS: MarkdownPreviewCommentLabels = {
  addComment: "Add comment",
  authorYou: "You",
  cancel: "Cancel",
  close: "Close",
  createFailed: "Couldn’t create comment",
  deleteComment: "Delete",
  deleteFailed: "Couldn’t delete comment",
  deleted: "Deleted",
  driftTitle: "Comments that can no longer be located precisely",
  editComment: "Edit",
  inputPlaceholder: "Add comment...",
  save: "Save",
  submit: "Submit",
  title: "Comment",
  updateFailed: "Couldn’t update comment",
  viewComment: "View comment",
  viewComments: "View {{count}} comments",
};

function toCommentLabels(
  labels: MarkdownPreviewCommentLabels
): MarkdownCommentLabels {
  return {
    addComment: labels.addComment,
    authorYou: labels.authorYou,
    cancel: labels.cancel,
    close: labels.close,
    createFailed: labels.createFailed,
    deleteComment: labels.deleteComment,
    deleteFailed: labels.deleteFailed,
    deleted: labels.deleted,
    driftTitle: labels.driftTitle,
    editComment: labels.editComment,
    inputPlaceholder: labels.inputPlaceholder,
    save: labels.save,
    submit: labels.submit,
    title: labels.title,
    updateFailed: labels.updateFailed,
  };
}

export function useMarkdownPreviewCommentsLayer(input: {
  readonly commentLabels: MarkdownPreviewCommentLabels;
  readonly commentsContext: RendererPluginContext | undefined;
  readonly document: MarkdownIrDocument | undefined;
  readonly pagination?: MarkdownPagination | undefined;
  readonly relativeCommentPath: string | undefined;
  readonly scrollRootRef?: RefObject<HTMLElement | null> | undefined;
  readonly worktreeKey: string | undefined;
}): {
  readonly commentsChrome: MarkdownIrCommentsChrome | undefined;
  readonly commentNavigator: ReactNode;
  readonly driftStrip: ReactNode;
  readonly forceCommentPageIndex: number | undefined;
} {
  // Require a parsed document so comment chrome never mounts on an empty shell.
  const enabled = Boolean(
    input.commentsContext &&
      input.document &&
      input.relativeCommentPath &&
      input.worktreeKey
  );
  const labels = toCommentLabels(input.commentLabels);
  const comments = useMarkdownPreviewComments({
    context: input.commentsContext,
    document: input.document,
    labels,
    path: input.relativeCommentPath,
    worktreeKey: input.worktreeKey,
  });
  const [reveal, setReveal] = useState<MarkdownCommentReveal | null>(null);
  const [forceCommentPageIndex, setForceCommentPageIndex] = useState<
    number | undefined
  >(undefined);
  const cancelScrollRef = useRef<(() => void) | null>(null);
  const requestOpenBlockKey = revealMatchesSurface(
    reveal,
    input.document,
    input.relativeCommentPath
  )
    ? reveal.blockKey
    : null;
  const requestOpenNonce = revealMatchesSurface(
    reveal,
    input.document,
    input.relativeCommentPath
  )
    ? reveal.nonce
    : 0;

  useEffect(
    () => () => {
      cancelScrollRef.current?.();
      cancelScrollRef.current = null;
    },
    []
  );

  // Re-resolve on languageChanged via useCommentNavigatorLabels.
  const filesT = useMemo(
    () => createFilesTranslate(input.commentsContext),
    [input.commentsContext]
  );
  const navLabels = useCommentNavigatorLabels(filesT);

  const onReveal = useCallback(
    (target: MarkdownCommentNavTarget) => {
      cancelScrollRef.current?.();
      cancelScrollRef.current = scheduleMarkdownCommentScroll(
        target,
        input.scrollRootRef?.current ?? null
      );
      if (target.kind === "located" && target.blockKey !== undefined) {
        const pageIndex = pageIndexForCommentBlockKey(
          input.pagination?.pages ?? [],
          target.blockKey
        );
        if (pageIndex !== null) {
          setForceCommentPageIndex(pageIndex);
        }
        setReveal((prev) =>
          nextMarkdownCommentReveal(prev, {
            blockKey: target.blockKey ?? null,
            document: input.document,
            path: input.relativeCommentPath,
          })
        );
        return;
      }
      setReveal((prev) =>
        nextMarkdownCommentReveal(prev, {
          blockKey: null,
          document: input.document,
          path: input.relativeCommentPath,
        })
      );
    },
    [
      input.document,
      input.pagination?.pages,
      input.relativeCommentPath,
      input.scrollRootRef,
    ]
  );

  const navigator = useCommentNavigatorController({
    context: input.commentsContext,
    labels: navLabels,
    onReveal,
    targets: comments.navTargets,
    worktreeKey: input.worktreeKey,
  });

  if (!enabled) {
    return {
      commentNavigator: null,
      commentsChrome: undefined,
      driftStrip: null,
      forceCommentPageIndex: undefined,
    };
  }

  return {
    commentNavigator: navigator.visible ? (
      <CommentNavigator
        activeIndex={navigator.activeIndex}
        clearLabel={navigator.clearLabel}
        nextLabel={navigator.nextLabel}
        onClear={navigator.onClear}
        onNext={navigator.onNext}
        onPrevious={navigator.onPrevious}
        onRevealCurrent={navigator.onRevealCurrent}
        positionLabel={navigator.positionLabel}
        previousLabel={navigator.previousLabel}
        toolbarLabel={navigator.toolbarLabel}
        total={navigator.total}
      />
    ) : null,
    commentsChrome: {
      addCommentLabel: input.commentLabels.addComment,
      draftBlockKey: comments.draftBlockKey,
      handlers: comments.handlers,
      labels,
      locatedByBlockKey: comments.locatedByBlockKey,
      onOpenDraft: comments.openDraftForBlockKey,
      requestOpenBlockKey,
      requestOpenNonce,
      viewCommentLabel: input.commentLabels.viewComment,
      viewCommentsLabel: input.commentLabels.viewComments,
    },
    driftStrip: (
      <MarkdownCommentDriftStrip
        comments={comments.driftComments}
        handlers={comments.handlers}
        labels={labels}
        title={input.commentLabels.driftTitle}
      />
    ),
    forceCommentPageIndex,
  };
}
