import { Button } from "@pier/ui/button.tsx";
import { STATUS_BAR_ITEM_TRIGGER_CLASS } from "@pier/ui/interactive-density.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { MessageSquareIcon } from "lucide-react";
import { useEffect } from "react";
import { useT } from "@/i18n/use-t.ts";
import { openCommentsActionDialog } from "@/lib/comments/action-dialog.tsx";
import { processableCommentCount } from "@/lib/comments/processable.ts";
import {
  ensureCommentsLoaded,
  hasUnreadComments,
  useCommentsStore,
} from "@/stores/comments.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { CORE_COMMENTS_STATUS_ITEM_ID } from "./core-terminal-status-items.ts";
import { terminalStatusItemRegistry } from "./status-bar.tsx";

/**
 * Agent 终端状态栏评论入口。
 *
 * - 仅 agent 对话 + 有 worktree 且存在可处理（未提交 diff）评论时显示。
 * - 计数 = processable（与弹窗列表一致，剔孤儿/非 uncommitted）。
 * - 点击打开 content dialog：列表跳转 + 取消 / 清除 / 提交并清除。
 */
function CommentsStatusItemView({
  context,
  getGroupId,
  panelId,
}: {
  context: PanelContext | undefined;
  getGroupId: () => string | null;
  panelId: string;
}) {
  const t = useT();
  const worktreeKey =
    context?.worktreeKey ?? context?.worktreeRoot ?? context?.gitRoot;
  const project = useCommentsStore((s) =>
    worktreeKey ? s.projects[worktreeKey] : undefined
  );
  const isAgent = useForegroundActivityStore(
    (s) => s.activities[panelId]?.kind === "agent"
  );

  useEffect(() => {
    if (worktreeKey && isAgent) {
      ensureCommentsLoaded(worktreeKey).catch(() => undefined);
    }
  }, [isAgent, worktreeKey]);

  if (!(worktreeKey && isAgent && context)) {
    return null;
  }
  const count = processableCommentCount(project?.threads);
  if (count === 0) {
    return null;
  }
  const unread = hasUnreadComments(project);
  const label = t("terminal.statusBar.item.comments.openCount", { count });

  return (
    <Button
      aria-label={label}
      className={STATUS_BAR_ITEM_TRIGGER_CLASS}
      data-testid="comments-status-item"
      data-unread={unread ? true : undefined}
      onClick={() => {
        openCommentsActionDialog({
          context,
          getGroupId: getGroupId ?? null,
          panelId,
          worktreeKey,
        }).catch(() => undefined);
      }}
      size="status-bar"
      type="button"
      variant="ghost"
    >
      <MessageSquareIcon aria-hidden="true" data-icon />
      <span className="tabular-nums">{count}</span>
      {unread ? (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-action-accent"
        />
      ) : null}
    </Button>
  );
}

/**
 * 注册核心评论状态栏 item。
 * isVisible：agent 活动 + worktree；render 内再按可处理评论数决定是否出 chip。
 */
export function registerCommentsStatusItem(): () => void {
  return terminalStatusItemRegistry.register({
    id: CORE_COMMENTS_STATUS_ITEM_ID,
    isVisible: (ctx) => {
      const hasWorktree = !!(
        ctx.context?.worktreeKey ??
        ctx.context?.worktreeRoot ??
        ctx.context?.gitRoot
      );
      if (!hasWorktree) {
        return false;
      }
      return (
        useForegroundActivityStore.getState().activities[ctx.panelId]?.kind ===
        "agent"
      );
    },
    render: (ctx) => (
      <CommentsStatusItemView
        context={ctx.context}
        getGroupId={ctx.getGroupId}
        panelId={ctx.panelId}
      />
    ),
  });
}
