/**
 * 消息 action 分发器：toast / popover / panel 的同一套行为。
 * 执行成功后标记已读；action 所需的上下文经 actionParams 携带。
 */
import type { AppNotification } from "@shared/contracts/notification-center.ts";
import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import i18next from "i18next";
import {
  openTaskRunOutput,
  revealTaskRun,
} from "@/lib/actions/task-run-operations.ts";
import { invokeAgentRuntimeFocus } from "@/lib/agent-runtime/focus-feedback.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";

function taskRunLabel(run: TaskRunControlEntry): string {
  return run.nodes[run.rootTaskId]?.label ?? run.rootTaskId;
}

function openTaskRunFromNotification(run: TaskRunControlEntry): void {
  const label = taskRunLabel(run);
  const open =
    run.mode === "background"
      ? openTaskRunOutput(run, label)
      : revealTaskRun(run);
  open.catch((error: unknown) => {
    showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: i18next.t(
        run.mode === "background"
          ? "terminal.runtimeControl.openOutputFailed"
          : "terminal.runtimeControl.revealFailed"
      ),
    });
  });
}

/** 执行消息卡片上的 action；未知 action id 静默（前向兼容新版 action）。 */
export function runNotificationAction(
  notification: AppNotification,
  actionId: string
): void {
  switch (actionId) {
    case "relaunch": {
      // 动态 import 破环：app-update.store → system-notify → 本模块。
      import("@/stores/app-update.store.ts")
        .then(({ useAppUpdateStore }) =>
          useAppUpdateStore
            .getState()
            .quitAndInstall()
            .catch(() => undefined)
        )
        .catch(() => undefined);
      break;
    }
    case "open-output": {
      const runId = notification.actionParams?.runId;
      const run = runId
        ? useTaskRunsStore.getState().snapshot.runs[runId]
        : undefined;
      // 渲染期已按可用性过滤（isNotificationActionAvailable），此处为兜底防御。
      if (!run) {
        break;
      }
      openTaskRunFromNotification(run);
      break;
    }
    case "focus-panel": {
      const agentRef =
        notification.agentRef ?? notification.actionParams?.agentRef;
      if (!agentRef) {
        break;
      }
      // 结果反馈与 IPC 异常统一走 focus-feedback 失败族（toast/alert + 落档），禁止静默。
      invokeAgentRuntimeFocus(() =>
        window.pier.agentRuntimeIndex.focus(agentRef)
      ).catch(() => undefined);
      break;
    }
    case "open-settings": {
      const section = notification.actionParams?.section ?? "terminal";
      import("@/stores/settings-dialog.store.ts")
        .then(({ useSettingsDialogStore }) => {
          useSettingsDialogStore.getState().openSection(section);
        })
        .catch(() => undefined);
      break;
    }
    default:
      break;
  }
  // toast 副本（id 以 toast: 前缀本地生成）不在 NCS 历史中——按 dedupeKey 标已读。
  if (notification.id.startsWith("toast:") && notification.dedupeKey) {
    window.pier.notificationCenter
      .markReadByDedupeKey(notification.dedupeKey)
      .catch(() => undefined);
    return;
  }
  window.pier.notificationCenter
    .markRead(notification.id)
    .catch(() => undefined);
}

/**
 * action 目标当前是否可用（渲染期过滤死链 action，点击不报错）。
 * - open-output：task run 仍在 task-runs 内存快照（重启后不可回看，按钮隐藏）
 * - focus-panel：agent 仍在本机 runtime index 里
 * - 其他 action（relaunch 等）恒可用
 */
export function isNotificationActionAvailable(
  notification: AppNotification,
  actionId: string,
  state: {
    agentEntries: readonly { agentRef: string }[];
    runs: Readonly<Record<string, unknown>>;
  }
): boolean {
  if (actionId === "open-output") {
    const runId = notification.actionParams?.runId;
    return runId ? runId in state.runs : false;
  }
  if (actionId === "focus-panel") {
    const agentRef =
      notification.agentRef ?? notification.actionParams?.agentRef;
    if (!agentRef) {
      return false;
    }
    return state.agentEntries.some((entry) => entry.agentRef === agentRef);
  }
  return true;
}
