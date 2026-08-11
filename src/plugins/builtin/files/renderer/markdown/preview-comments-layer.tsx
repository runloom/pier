/**
 * Markdown preview comments: hook + drift strip + IR chrome props.
 */
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { ReactNode } from "react";
import type { MarkdownIrDocument } from "./ir.ts";
import type { MarkdownIrCommentsChrome } from "./ir-comments-types.ts";
import { MarkdownCommentDriftStrip } from "./preview-comment-block.tsx";
import {
  type MarkdownCommentLabels,
  useMarkdownPreviewComments,
} from "./use-preview-comments.ts";

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

export function useMarkdownPreviewCommentsLayer(input: {
  readonly commentLabels: MarkdownPreviewCommentLabels;
  readonly commentsContext: RendererPluginContext | undefined;
  readonly document: MarkdownIrDocument | undefined;
  readonly relativeCommentPath: string | undefined;
  readonly worktreeKey: string | undefined;
}): {
  readonly commentsChrome: MarkdownIrCommentsChrome | undefined;
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

  if (!enabled) {
    return { commentsChrome: undefined, driftStrip: null };
  }

  return {
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
