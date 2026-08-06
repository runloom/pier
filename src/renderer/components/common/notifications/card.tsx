/**
 * NotificationCard — 消息中心唯一的消息呈现组件（设计文档 §6.0）。
 * 仅 Popover 列表使用：无前置状态图标，只由 标题/详情/时间
 * + 未读红点 + 操作组成；toast 走 sonner 原生结构（见 show-notification-toast）。
 */
import { Button } from "@pier/ui/button.tsx";
import { formatRelativeTime } from "@pier/ui/format.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { AppNotification } from "@shared/contracts/notification-center.ts";
import i18next from "i18next";
import { type ReactNode, useMemo } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  isNotificationActionAvailable,
  runNotificationAction,
} from "@/lib/notifications/actions.ts";
import { useAgentRuntimeIndexStore } from "@/stores/agent-runtime-index.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";

function notificationTitle(notification: AppNotification): string {
  if (notification.titleKey) {
    const resolved = i18next.t(
      notification.titleKey,
      notification.titleParams ?? {}
    );
    if (resolved !== notification.titleKey) {
      return resolved;
    }
  }
  return notification.title;
}

function markRead(notification: AppNotification): void {
  if (notification.read) {
    return;
  }
  window.pier.notificationCenter
    .markRead(notification.id)
    .catch(() => undefined);
}

export function NotificationCard({
  notification,
  onActionRun,
}: {
  notification: AppNotification;
  /** action 执行后回调；popover 传入关层，其它载体可不传。 */
  onActionRun?: () => void;
}): ReactNode {
  const t = useT();
  const title = notificationTitle(notification);
  // 渲染期过滤死链 action（如重启后 task run 已不在内存快照）：
  // 目标不可用的按钮直接不渲染，不留给用户一个注定失败的点击。
  const taskRunsSnapshot = useTaskRunsStore((s) => s.snapshot);
  const agentEntries = useAgentRuntimeIndexStore((s) => s.entries);
  const availableActions = useMemo(
    () =>
      notification.actions?.filter((action) =>
        isNotificationActionAvailable(notification, action.id, {
          agentEntries,
          runs: taskRunsSnapshot.runs,
        })
      ),
    [notification, taskRunsSnapshot, agentEntries]
  );

  return (
    <Item
      className={cn(
        "relative cursor-pointer py-1 hover:bg-muted",
        notification.read ? "opacity-80" : ""
      )}
      data-kind={notification.kind}
      data-slot="notification-card"
      onClick={() => {
        markRead(notification);
      }}
      size="sm"
    >
      {/* inbox 条目无前置状态图标：状态着色是 toast 专属（结果确认）；
          消息中心里只有标题/详情/时间三个信息槽位。 */}
      <ItemContent className="min-w-0 flex-1">
        <ItemTitle className="line-clamp-none max-w-full flex-wrap whitespace-normal">
          {/* 标题区是整卡的语义点击面（标记已读）；action 按钮为平级兄弟，避免嵌套交互元素。 */}
          {title}
          <span className="shrink-0 text-muted-foreground/50 text-xs tabular-nums">
            {formatRelativeTime(notification.ts, Date.now(), i18next.language)}
          </span>
          {notification.repeatCount && notification.repeatCount > 1 ? (
            <span className="shrink-0 text-muted-foreground/50 text-xs">
              {t("notificationsCenter.repeat", {
                count: notification.repeatCount,
              })}
            </span>
          ) : null}
        </ItemTitle>
        {notification.body ? (
          <ItemDescription className="line-clamp-none max-w-full whitespace-pre-wrap break-words">
            {notification.body}
          </ItemDescription>
        ) : null}
      </ItemContent>
      {availableActions?.map((action, index) => (
        <Button
          key={action.id}
          onClick={(event) => {
            event.stopPropagation();
            runNotificationAction(notification, action.id);
            // 当前卡片 action 均为离开收件箱的深链；popover 传 onActionRun 关层。
            onActionRun?.();
          }}
          size="xs"
          type="button"
          variant={index === 0 ? "outline" : "secondary"}
        >
          {t(action.labelKey)}
        </Button>
      ))}
      {notification.read ? null : (
        <span
          className="absolute top-2 right-2 size-2 shrink-0 self-start rounded-full bg-destructive"
          data-slot="notification-unread-dot"
        />
      )}
    </Item>
  );
}
