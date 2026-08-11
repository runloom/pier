/**
 * Canvas 预览工具栏：评论清单 + 文件级添加 + Design Mode 点选标注。
 */
import { Button } from "@pier/ui/button.tsx";
import { InlineReviewCommentEditor } from "@pier/ui/diff-view/review/inline-comment-editor.tsx";
import { InlineReviewThreadCard } from "@pier/ui/diff-view/review/inline-thread-card.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@pier/ui/popover.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { Crosshair, MessageSquare, MessageSquarePlus } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import type { FilesTranslate } from "../i18n.ts";
import {
  type CanvasCommentsSession,
  getCanvasCommentsSession,
  getCanvasCommentsSessionsRevision,
  subscribeCanvasCommentsSessions,
} from "./canvas-comments-session.ts";
import {
  CANVAS_FILE_DRAFT_ID,
  type CanvasCommentLabels,
  type CanvasCommentThreadView,
} from "./use-canvas-preview-comments.ts";

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

function ThreadList(props: {
  readonly handlers: CanvasCommentsSession["handlers"];
  readonly labels: CanvasCommentLabels;
  readonly threads: readonly CanvasCommentThreadView[];
}) {
  if (props.threads.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-col gap-2">
      {props.threads.map((thread) => (
        <li key={thread.threadId}>
          {thread.anchorId || thread.label ? (
            <p className="mb-1 truncate text-muted-foreground text-xs">
              {thread.label ?? thread.anchorId}
            </p>
          ) : null}
          <InlineReviewThreadCard
            handlers={props.handlers}
            labels={props.labels}
            thread={thread}
          />
        </li>
      ))}
    </ul>
  );
}

function CanvasCommentsPopover(props: {
  readonly comments: CanvasCommentsSession;
  readonly labels: CanvasCommentLabels;
  readonly t: FilesTranslate;
}) {
  const { comments, labels } = props;
  const locatedNodeThreads: CanvasCommentThreadView[] = [];
  for (const list of comments.locatedByAnchorId.values()) {
    locatedNodeThreads.push(...list);
  }
  const nodeThreads = [...locatedNodeThreads, ...comments.pickedNodeThreads];
  const count =
    comments.fileThreads.length +
    nodeThreads.length +
    comments.driftNodeThreads.length;
  const triggerLabel =
    count > 0
      ? props
          .t("filePanel.canvas.comment.openWithCount", "Comments ({{count}})")
          .replace("{{count}}", String(count))
      : labels.title;

  const fileDraft = comments.draftOpen && comments.draftPick === null;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <PopoverTrigger asChild>
              <Button
                aria-label={triggerLabel}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <MessageSquare data-icon="inline-start" />
              </Button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent align="center" side="bottom" sideOffset={4}>
          {triggerLabel}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 gap-3 p-3" side="bottom">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-sm">{labels.title}</p>
          {fileDraft ? null : (
            <Button
              aria-label={labels.addComment}
              onClick={() => comments.openFileDraft()}
              size="icon-xs"
              type="button"
              variant="outline"
            >
              <MessageSquarePlus data-icon="inline-start" />
            </Button>
          )}
        </div>
        {fileDraft ? (
          <InlineReviewCommentEditor
            labels={labels}
            onCancel={() =>
              comments.handlers.onCancelDraft(CANVAS_FILE_DRAFT_ID)
            }
            onSubmit={async (body) =>
              comments.handlers.onSubmitDraft(CANVAS_FILE_DRAFT_ID, body)
            }
          />
        ) : null}
        {comments.draftOpen && comments.draftPick ? (
          <p className="text-muted-foreground text-xs">
            {props
              .t(
                "filePanel.canvas.comment.draftOnNode",
                "Commenting on “{{label}}” on the canvas."
              )
              .replace("{{label}}", comments.draftPick.label)}
          </p>
        ) : null}
        {count === 0 && !fileDraft ? (
          <p className="text-muted-foreground text-xs">{labels.empty}</p>
        ) : null}
        {comments.fileThreads.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium text-muted-foreground text-xs">
              {labels.fileLevel}
            </p>
            <ThreadList
              handlers={comments.handlers}
              labels={labels}
              threads={comments.fileThreads}
            />
          </div>
        ) : null}
        {nodeThreads.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium text-muted-foreground text-xs">
              {labels.nodeLevel}
            </p>
            <ThreadList
              handlers={comments.handlers}
              labels={labels}
              threads={nodeThreads}
            />
          </div>
        ) : null}
        {comments.driftNodeThreads.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium text-muted-foreground text-xs">
              {props.t(
                "filePanel.canvas.comment.driftTitle",
                "Comments that can no longer be located on a node"
              )}
            </p>
            <ThreadList
              handlers={comments.handlers}
              labels={labels}
              threads={comments.driftNodeThreads}
            />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
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
          onClick={() => {
            if (active) {
              comments.setPickMode(false);
              return;
            }
            comments.setPickMode(true);
          }}
          size="icon-xs"
          type="button"
          variant={active ? "secondary" : "ghost"}
        >
          <Crosshair data-icon="inline-start" />
        </Button>
      </TooltipTrigger>
      <TooltipContent align="center" side="bottom" sideOffset={4}>
        {aria}
      </TooltipContent>
    </Tooltip>
  );
}

/** Toolbar controls bound to the live preview session for `path`. */
export function CanvasCommentsButton(props: {
  readonly path: string;
  readonly t: FilesTranslate;
}) {
  const revision = useSyncExternalStore(
    subscribeCanvasCommentsSessions,
    getCanvasCommentsSessionsRevision,
    () => 0
  );
  // revision is the external session store epoch — re-read when it bumps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision drives re-read of module map
  const session = useMemo(
    () => getCanvasCommentsSession(props.path),
    [props.path, revision]
  );
  if (!session) {
    return null;
  }
  const labels = createCanvasCommentLabels(props.t);
  return (
    <>
      <CanvasAnnotateButton comments={session} labels={labels} />
      <CanvasCommentsPopover comments={session} labels={labels} t={props.t} />
    </>
  );
}
