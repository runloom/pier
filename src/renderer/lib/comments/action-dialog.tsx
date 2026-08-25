import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { Item, ItemActions, ItemTitle } from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { CommentFailureReason } from "@shared/contracts/comments/primitives.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import i18next from "i18next";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContentDialogFooterActions } from "@/components/common/dialogs/footer-actions.tsx";
import { useContentDialogFooter } from "@/components/common/dialogs/use-footer.ts";
import { useT } from "@/i18n/use-t.ts";
import { insertReviewCommentsIntoTerminalComposer } from "@/panel-kits/terminal/composer-bridge.ts";
import {
  type AppContentDialogRenderProps,
  openAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";
import {
  ensureCommentsLoaded,
  useCommentsStore,
} from "@/stores/comments.store.ts";
import { useUncommittedLivePaths } from "./live-paths.ts";
import {
  formatCommentsForComposer,
  type ProcessableCommentItem,
  pathInLiveSet,
  processableItemLocationText,
} from "./processable.ts";
import { revealComment } from "./reveal.ts";
import {
  projectProcessableComments,
  useProcessableCommentItems,
} from "./use-processable-items.ts";

function commentFailureTitleKey(
  reason: CommentFailureReason
): `terminal.statusBar.item.comments.failure.${CommentFailureReason}` {
  return `terminal.statusBar.item.comments.failure.${reason}`;
}

function processableSourceLabelKey(
  kind: ProcessableCommentItem["kind"]
):
  | "terminal.statusBar.item.comments.sourceGit"
  | "terminal.statusBar.item.comments.sourceMarkdown"
  | "terminal.statusBar.item.comments.sourceCanvas" {
  if (kind === "markdown") {
    return "terminal.statusBar.item.comments.sourceMarkdown";
  }
  if (kind === "canvas") {
    return "terminal.statusBar.item.comments.sourceCanvas";
  }
  return "terminal.statusBar.item.comments.sourceGit";
}

export type CommentsActionDialogResult =
  | "cancel"
  | "cleared"
  | "jumped"
  | "submitted"
  | null;

interface OpenCommentsActionDialogInput {
  readonly context: PanelContext;
  readonly getGroupId: (() => string | null) | null;
  readonly panelId: string;
  readonly worktreeKey: string;
}

function CommentsActionDialogBody({
  close,
  context,
  getGroupId,
  panelId,
  setFooter,
  setTitle,
  worktreeKey,
}: AppContentDialogRenderProps<CommentsActionDialogResult> &
  OpenCommentsActionDialogInput) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const project = useCommentsStore((state) => state.projects[worktreeKey]);
  const gitRoot =
    context.gitRoot ?? context.worktreeRoot ?? context.projectRootPath;
  const livePaths = useUncommittedLivePaths(gitRoot);
  // livePaths null：仍列 md/canvas；git-diff 在 processable 内因 livePaths 省略而跳过。
  // livePaths Set：git 路径过滤 + md/canvas。
  const items = useProcessableCommentItems(project?.threads, livePaths);

  useEffect(() => {
    setTitle(t("terminal.statusBar.item.comments.dialogTitle"));
  }, [setTitle, t]);

  useEffect(() => {
    ensureCommentsLoaded(worktreeKey).catch(() => undefined);
  }, [worktreeKey]);

  const deleteOne = async (
    item: ProcessableCommentItem,
    options?: { readonly alertOnError?: boolean }
  ): Promise<boolean> => {
    const alertOnError = options?.alertOnError !== false;
    const result = await window.pier.comments.deleteComment({
      commentId: item.commentId,
      threadId: item.threadId,
      worktreeKey,
    });
    if (result.kind === "error") {
      if (alertOnError) {
        await showAppAlert({
          body: t(commentFailureTitleKey(result.reason)),
          title: t("terminal.statusBar.item.comments.deleteFailed"),
        });
      }
      return false;
    }
    return true;
  };

  const jumpTo = async (item: ProcessableCommentItem) => {
    if (busy) {
      return;
    }
    const gitPathLive =
      item.kind === "git-diff" && livePaths !== null
        ? pathInLiveSet(item.path, item.oldPath, livePaths)
        : undefined;
    const result = revealComment({
      context,
      ...(getGroupId ? { getGroupId } : {}),
      item,
      ...(gitPathLive === undefined ? {} : { gitPathLive }),
    });
    if (result.kind === "stale-git") {
      setBusy(true);
      try {
        await showAppAlert({
          body: t("terminal.statusBar.item.comments.staleJumpBody"),
          title: t("terminal.statusBar.item.comments.staleJumpTitle"),
        });
        await deleteOne(item, { alertOnError: false });
      } finally {
        setBusy(false);
      }
      return;
    }
    // markdown / canvas / git opened paths fall through below
    if (result.kind === "failed") {
      await showAppAlert({
        body: t("terminal.statusBar.item.comments.jumpFailedBody"),
        title: t("terminal.statusBar.item.comments.jumpFailed"),
      });
      return;
    }
    // Close only after Changes is open so a failed jump keeps the list.
    close("jumped");
  };

  const deleteAll = async (
    targets: readonly ProcessableCommentItem[]
  ): Promise<{ deleted: number; failed: number }> => {
    let deleted = 0;
    let failed = 0;
    for (const item of targets) {
      try {
        // Bulk path: one summary alert instead of N per-row alerts.
        const ok = await deleteOne(item, { alertOnError: false });
        if (ok) {
          deleted += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { deleted, failed };
  };

  const onDeleteOne = async (item: ProcessableCommentItem) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await deleteOne(item);
    } catch (error) {
      await showAppAlert({
        body: error instanceof Error ? error.message : String(error),
        title: t("terminal.statusBar.item.comments.deleteFailed"),
      });
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    if (busy || items.length === 0) {
      return;
    }
    const confirmed = await showAppConfirm({
      body: t("terminal.statusBar.item.comments.clearBody"),
      confirmLabel: t("terminal.statusBar.item.comments.clearConfirm"),
      intent: "destructive",
      title: t("terminal.statusBar.item.comments.clearTitle"),
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      const snapshot = items;
      const { deleted, failed } = await deleteAll(snapshot);
      if (failed === 0) {
        close("cleared");
        return;
      }
      await showAppAlert({
        body: t("terminal.statusBar.item.comments.clearPartialBody", {
          deleted,
          remaining: failed,
        }),
        title: t("terminal.statusBar.item.comments.clearPartialTitle"),
      });
    } catch (error) {
      await showAppAlert({
        body: error instanceof Error ? error.message : String(error),
        title: t("terminal.statusBar.item.comments.clearFailed"),
      });
    } finally {
      setBusy(false);
    }
  };

  const onSubmitAndClear = async () => {
    if (busy || items.length === 0) {
      return;
    }
    setBusy(true);
    try {
      // Re-project with live surfaces at handoff — do not use a stale list
      // built before a preview registered its surface.
      const snapshot = projectProcessableComments(project?.threads, livePaths);
      if (snapshot.length === 0) {
        setBusy(false);
        return;
      }
      const payload = formatCommentsForComposer(snapshot);
      const inserted = await insertReviewCommentsIntoTerminalComposer(panelId, {
        count: snapshot.length,
        label: t("terminal.statusBar.item.comments.chipLabel", {
          count: snapshot.length,
        }),
        payloadText: payload,
      });
      if (!inserted) {
        await showAppAlert({
          body: t("terminal.statusBar.item.comments.submitUnavailableBody"),
          title: t("terminal.statusBar.item.comments.submitFailed"),
        });
        return;
      }
      // Delete only after chip materialize ack — avoid permanent comment loss.
      const { deleted, failed } = await deleteAll(snapshot);
      if (failed === 0) {
        close("submitted");
        return;
      }
      // Chip is in the composer; remaining rows stay processable. Keep dialog open.
      await showAppAlert({
        body: t("terminal.statusBar.item.comments.submitPartialBody", {
          deleted,
          remaining: failed,
        }),
        title: t("terminal.statusBar.item.comments.submitPartialTitle"),
      });
    } catch (error) {
      await showAppAlert({
        body: error instanceof Error ? error.message : String(error),
        title: t("terminal.statusBar.item.comments.submitFailed"),
      });
    } finally {
      setBusy(false);
    }
  };

  const clearRef = useRef(onClear);
  clearRef.current = onClear;
  const submitRef = useRef(onSubmitAndClear);
  submitRef.current = onSubmitAndClear;

  const footer = useMemo(
    () => (
      <ContentDialogFooterActions
        cancelDisabled={busy}
        cancelLabel={t("dialog.cancel")}
        confirmDisabled={busy || items.length === 0}
        confirmLabel={t("terminal.statusBar.item.comments.submitAndClear")}
        confirmLoading={busy}
        middle={
          <Button
            disabled={busy || items.length === 0}
            onClick={() => {
              clearRef.current().catch(() => undefined);
            }}
            type="button"
            variant="destructive"
          >
            {t("terminal.statusBar.item.comments.clear")}
          </Button>
        }
        onCancel={() => {
          close("cancel");
        }}
        onConfirm={() => {
          submitRef.current().catch(() => undefined);
        }}
      />
    ),
    [busy, close, items.length, t]
  );
  useContentDialogFooter(setFooter, footer);

  // status 未到且尚无任何可展示项：骨架（避免空态闪烁）；有 md/canvas 则直接列。
  if (livePaths === null && items.length === 0) {
    return (
      <div
        aria-busy="true"
        className="flex min-h-40 flex-col gap-2"
        role="status"
      >
        <span className="sr-only">
          {t("terminal.statusBar.item.comments.loadingLabel")}
        </span>
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Empty className="min-h-40 border-0">
        <EmptyHeader>
          <EmptyTitle>
            {t("terminal.statusBar.item.comments.emptyTitle")}
          </EmptyTitle>
          <EmptyDescription>
            {t("terminal.statusBar.item.comments.emptyBody")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // Host content-dialog body owns scroll (overlay bar + equal px-6). Nested
  // ScrollArea would reserve a classic gutter and make left/right insets look uneven.
  //
  // Scheme 2: body primary; meta row is full card width so path sticks left
  // and Badge sticks right (same right edge as the delete control).
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => {
        const sourceLabel = t(processableSourceLabelKey(item.kind));
        const location = processableItemLocationText(item);
        const jump = () => {
          jumpTo(item).catch(() => undefined);
        };
        return (
          <li key={item.commentId}>
            <Item
              className={cn(
                // Item defaults to flex-wrap + items-center; force a full-width column.
                "w-full flex-col flex-nowrap items-stretch gap-1.5",
                "hover:bg-muted/40"
              )}
              size="sm"
              variant="outline"
            >
              <div className="flex w-full min-w-0 items-start justify-between gap-2">
                <button
                  className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  disabled={busy}
                  onClick={jump}
                  type="button"
                >
                  {/* Override ItemTitle defaults (line-clamp-1 / w-fit / font-medium). */}
                  <ItemTitle className="line-clamp-none block w-full max-w-full whitespace-pre-wrap break-words text-left font-normal text-foreground text-sm leading-snug">
                    {item.body}
                  </ItemTitle>
                </button>
                <ItemActions className="-mt-0.5 shrink-0">
                  <Button
                    aria-label={t("terminal.statusBar.item.comments.deleteOne")}
                    disabled={busy}
                    onClick={() => {
                      onDeleteOne(item).catch(() => undefined);
                    }}
                    size="icon-xs"
                    title={t("terminal.statusBar.item.comments.deleteOne")}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden data-icon />
                  </Button>
                </ItemActions>
              </div>
              <button
                className="flex w-full min-w-0 items-center justify-between gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                disabled={busy}
                onClick={jump}
                type="button"
              >
                <span className="min-w-0 flex-1 break-all text-left font-mono text-muted-foreground text-xs leading-snug">
                  {location}
                </span>
                <Badge className="shrink-0" size="xs" variant="secondary">
                  {sourceLabel}
                </Badge>
              </button>
            </Item>
          </li>
        );
      })}
    </ul>
  );
}

/** Agent 终端状态栏：评论列表 + 取消 / 清除 / 提交并清除。 */
export function openCommentsActionDialog(
  input: OpenCommentsActionDialogInput
): Promise<CommentsActionDialogResult> {
  function Body(
    props: AppContentDialogRenderProps<CommentsActionDialogResult>
  ) {
    return (
      <CommentsActionDialogBody
        {...props}
        context={input.context}
        getGroupId={input.getGroupId}
        panelId={input.panelId}
        worktreeKey={input.worktreeKey}
      />
    );
  }

  return openAppContentDialog<CommentsActionDialogResult>({
    content: Body,
    id: `terminal-comments-action:${input.panelId}`,
    size: "default",
    title: i18next.t("terminal.statusBar.item.comments.dialogTitle"),
  }).result;
}
