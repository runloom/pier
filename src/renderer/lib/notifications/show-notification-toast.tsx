/**
 * 消息型 toast（形态 B）的统一渲染：标准 shadcn sonner 卡片。
 * 仅由 main 单投桥（NotificationMessageToastBridge）调用：标题（必备）+ 详情
 * （必备 ≤1 行）+ ≤1 outline 操作 + 关闭 X；无前置状态图标；severity 只驱动时长分级。
 *
 * 多窗口：投递权在 main（resolveToastTarget + sendMessageToastToOneWindow）；
 * 本模块只负责渲染，不做 focus 门闩。
 * 形态 A（确认型 toast）不走这里，维持触发窗本地 sonner 反色胶囊。
 */

import type { AppNotification } from "@shared/contracts/notification-center.ts";
import i18next from "i18next";
import type { CSSProperties } from "react";
import { toast } from "sonner";
import {
  isNotificationActionAvailable,
  runNotificationAction,
} from "@/lib/notifications/notification-actions.ts";
import { useAgentRuntimeIndexStore } from "@/stores/agent-runtime-index.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";

const SOURCE_GROUP = {
  agent: "agent",
  plugin: "plugin",
  system: "system",
  task: "task",
} as const;

function sourceGroupFor(kind: AppNotification["kind"]): string {
  if (kind.startsWith("agent.")) {
    return SOURCE_GROUP.agent;
  }
  if (kind.startsWith("task-run.")) {
    return SOURCE_GROUP.task;
  }
  if (kind === "plugin.event") {
    return SOURCE_GROUP.plugin;
  }
  return SOURCE_GROUP.system;
}

/** 详情槽位（必备）：优先消息详情；无详情时回退为类型/来源行。 */
function detailFor(notification: AppNotification): string {
  if (notification.body) {
    return notification.body;
  }
  // 插件消息带上插件 id 归因，而非通用「插件」文案。
  if (notification.kind === "plugin.event") {
    return i18next.t("notificationsCenter.source.pluginDetail", {
      source: notification.source,
    });
  }
  return i18next.t(
    `notificationsCenter.source.${sourceGroupFor(notification.kind)}`
  );
}

function toastDurationFor(severity: AppNotification["severity"]): number {
  if (severity === "error") {
    return 10_000;
  }
  if (severity === "warning") {
    return 6000;
  }
  return 4000;
}

export function showNotificationToast(notification: AppNotification): void {
  // 与卡片一致的渲染期死链过滤：目标已消失的 action 不出现在 toast 上。
  const availabilityState = {
    agentEntries: useAgentRuntimeIndexStore.getState().entries,
    runs: useTaskRunsStore.getState().snapshot.runs,
  };
  const primaryAction = notification.actions?.find((action) =>
    isNotificationActionAvailable(notification, action.id, availabilityState)
  );
  // 形态 B 走 sonner 默认 [data-styled=true] 卡片：通过 per-call style 把
  // --normal-* 切到卡片语义令牌，sonner 默认规则自动渲染卡片几何（背景/圆角/
  // 边框/padding/box-shadow/align-items:center）。globals.css 里 .pier-msg-toast
  // 只补 sonner 不提供的差异（close 定位、title 字重、description 截断、action outline）。
  toast(notification.title, {
    action: primaryAction
      ? {
          label: i18next.t(primaryAction.labelKey),
          onClick: () => {
            runNotificationAction(notification, primaryAction.id);
          },
        }
      : undefined,
    className: "pier-msg-toast",
    closeButton: true,
    description: detailFor(notification),
    duration: toastDurationFor(notification.severity),
    style: {
      "--normal-bg": "var(--popover)",
      "--normal-text": "var(--popover-foreground)",
      "--normal-border": "var(--border)",
      "--border-radius": "16px",
      "--width": "min(360px, calc(100vw - 32px))",
    } as CSSProperties,
  });
}
