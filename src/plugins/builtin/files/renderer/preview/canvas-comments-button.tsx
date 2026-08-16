/**
 * Canvas 预览工具栏：仅 Design Mode 点选标注开关。
 * 评论清单走终端状态栏「评论」对话（processable），不在此重复气泡入口。
 */
import { Button } from "@pier/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { Crosshair } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import type { FilesTranslate } from "../i18n.ts";
import {
  type CanvasCommentsSession,
  getCanvasCommentsSession,
  getCanvasCommentsSessionsRevision,
  subscribeCanvasCommentsSessions,
} from "./canvas-comments-session.ts";
import type { CanvasCommentLabels } from "./use-canvas-preview-comments.ts";

export function createCanvasCommentLabels(
  t: FilesTranslate
): CanvasCommentLabels {
  return {
    addComment: t("filePanel.canvas.comment.add", "Add comment"),
    annotate: t("filePanel.canvas.comment.annotate", "Annotate on canvas"),
    annotateActive: t(
      "filePanel.canvas.comment.annotateActive",
      "Click an element to comment"
    ),
    authorYou: t("filePanel.canvas.comment.authorYou", "You"),
    driftTitle: t(
      "filePanel.canvas.comment.driftTitle",
      "Comments that can no longer be located on a node"
    ),
    close: t("filePanel.canvas.comment.close", "Close"),
    createFailed: t(
      "filePanel.canvas.comment.createFailed",
      "Couldn’t create comment"
    ),
    deleteComment: t("filePanel.canvas.comment.delete", "Delete"),
    deleteFailed: t(
      "filePanel.canvas.comment.deleteFailed",
      "Couldn’t delete comment"
    ),
    deleted: t("filePanel.canvas.comment.deleted", "Deleted"),
    editComment: t("filePanel.canvas.comment.edit", "Edit"),
    empty: t(
      "filePanel.canvas.comment.empty",
      "No comments on this canvas yet."
    ),
    fileLevel: t("filePanel.canvas.comment.fileLevel", "File"),
    inputPlaceholder: t(
      "filePanel.canvas.comment.placeholder",
      "Write a comment…"
    ),
    nodeLevel: t("filePanel.canvas.comment.nodeLevel", "Elements"),
    submit: t("filePanel.canvas.comment.submit", "Submit"),
    title: t("filePanel.canvas.comment.title", "Comments"),
    updateFailed: t(
      "filePanel.canvas.comment.updateFailed",
      "Couldn’t update comment"
    ),
  };
}

function CanvasAnnotateButton(props: {
  readonly comments: CanvasCommentsSession;
  readonly labels: CanvasCommentLabels;
}) {
  const { comments, labels } = props;
  const active = comments.pickMode;
  const aria = active ? labels.annotateActive : labels.annotate;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={aria}
          aria-pressed={active}
          className="ml-1"
          onClick={() => {
            comments.setPickMode(!active);
          }}
          size="icon-xs"
          type="button"
          variant={active ? "secondary" : "ghost"}
        >
          <Crosshair data-icon="inline-start" />
        </Button>
      </TooltipTrigger>
      <TooltipContent align="end" side="bottom">
        {aria}
      </TooltipContent>
    </Tooltip>
  );
}

/** Toolbar annotate control bound to the live preview session for `path`. */
export function CanvasCommentsButton(props: {
  readonly path: string;
  readonly t: FilesTranslate;
}) {
  const revision = useSyncExternalStore(
    subscribeCanvasCommentsSessions,
    getCanvasCommentsSessionsRevision,
    () => 0
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision drives re-read of module map
  const session = useMemo(
    () => getCanvasCommentsSession(props.path),
    [props.path, revision]
  );
  if (!session) {
    return null;
  }
  const labels = createCanvasCommentLabels(props.t);
  return <CanvasAnnotateButton comments={session} labels={labels} />;
}
