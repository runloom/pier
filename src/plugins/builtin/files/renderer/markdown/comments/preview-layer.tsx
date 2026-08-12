/**
 * Markdown preview comments: hook + drift strip + IR chrome props + navigator.
 */
import { CommentNavigator } from "@pier/ui/comments/navigator.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { type ReactNode, type RefObject, useCallback, useMemo } from "react";
import {
  useCommentNavigatorController,
  useCommentNavigatorLabels,
} from "../../comments/use-comment-navigator.ts";
import { createFilesTranslate } from "../../i18n.ts";
import type { MarkdownIrDocument } from "../ir.ts";
import type { MarkdownIrCommentsChrome } from "./ir-types.ts";
import { MarkdownCommentDriftStrip } from "./preview-block.tsx";
import {
  type MarkdownCommentLabels,
  type MarkdownCommentNavTarget,
  useMarkdownPreviewComments,
} from "./use-preview.ts";

export interface MarkdownPreviewCommentLabels {
  addComment: string;
  authorYou: string;
  close: string;
  createFailed: string;
  deleteComment: string;
  deleted: string;
  deleteFailed: string;
  driftTitle: string;
  editComment: string;
  inputPlaceholder: string;
  submit: string;
  title: string;
  updateFailed: string;
}

export const DEFAULT_MARKDOWN_COMMENT_LABELS: MarkdownPreviewCommentLabels = {
  addComment: "Add comment",
  authorYou: "You",
  close: "Close",
  createFailed: "Couldn’t create comment",
  deleteComment: "Delete",
  deleteFailed: "Couldn’t delete comment",
  deleted: "Deleted",
  driftTitle: "Comments that can no longer be located precisely",
  editComment: "Edit",
  inputPlaceholder: "Write a comment…",
  submit: "Submit",
  title: "Comment",
  updateFailed: "Couldn’t update comment",
};

function toCommentLabels(
  labels: MarkdownPreviewCommentLabels
): MarkdownCommentLabels {
  return {
    addComment: labels.addComment,
    authorYou: labels.authorYou,
    close: labels.close,
    createFailed: labels.createFailed,
    deleteComment: labels.deleteComment,
    deleteFailed: labels.deleteFailed,
    deleted: labels.deleted,
    driftTitle: labels.driftTitle,
    editComment: labels.editComment,
    inputPlaceholder: labels.inputPlaceholder,
    submit: labels.submit,
    title: labels.title,
    updateFailed: labels.updateFailed,
  };
}

function revealMarkdownCommentTarget(
  target: MarkdownCommentNavTarget,
  scrollRoot: HTMLElement | null
): void {
  if (!scrollRoot) {
    return;
  }
  const selector =
    target.kind === "located" && target.blockKey !== undefined
      ? `[data-markdown-comment-block=${JSON.stringify(target.blockKey)}]`
      : "[data-markdown-comment-drift]";
  const el = scrollRoot.querySelector(selector);
  if (!(el instanceof HTMLElement)) {
    return;
  }
  el.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function useMarkdownPreviewCommentsLayer(input: {
  readonly commentLabels: MarkdownPreviewCommentLabels;
  readonly commentsContext: RendererPluginContext | undefined;
  readonly document: MarkdownIrDocument | undefined;
  readonly relativeCommentPath: string | undefined;
  readonly scrollRootRef?: RefObject<HTMLElement | null> | undefined;
  readonly worktreeKey: string | undefined;
}): {
  readonly commentsChrome: MarkdownIrCommentsChrome | undefined;
  readonly commentNavigator: ReactNode;
  readonly driftStrip: ReactNode;
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

  // Re-resolve on languageChanged via useCommentNavigatorLabels.
  const filesT = useMemo(
    () => createFilesTranslate(input.commentsContext),
    [input.commentsContext]
  );
  const navLabels = useCommentNavigatorLabels(filesT);

  const onReveal = useCallback(
    (target: MarkdownCommentNavTarget) => {
      revealMarkdownCommentTarget(target, input.scrollRootRef?.current ?? null);
    },
    [input.scrollRootRef]
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
    },
    driftStrip: (
      <MarkdownCommentDriftStrip
        comments={comments.driftComments}
        handlers={comments.handlers}
        labels={labels}
        title={input.commentLabels.driftTitle}
      />
    ),
  };
}
