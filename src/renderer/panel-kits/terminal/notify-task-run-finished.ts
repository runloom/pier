import { formatDurationShort } from "@pier/ui/format.tsx";
import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import i18next from "i18next";
import { systemNotify } from "@/lib/notifications/system-notify.ts";

// toast 同步连发节流（会话内）；记录去重由 NCS dedupeKey 负责（跨会话）。
const notifiedRunIds = new Set<string>();

function isActiveTaskRunStatus(status: TaskRunControlEntry["status"]): boolean {
  return status === "pending" || status === "running" || status === "stopping";
}

function taskRunLabel(run: TaskRunControlEntry): string {
  return run.nodes[run.rootTaskId]?.label ?? run.rootTaskId;
}

/**
 * 详情槽位：body = {{label}} + 有用上下文（时长/退出码/阻塞原因）。
 * 时长取 run 级 startedAt → updatedAt（终态迁移会刷新 updatedAt），exitCode 取根节点。
 */
function taskRunDetail(run: TaskRunControlEntry, label: string): string {
  const duration = formatDurationShort(
    run.updatedAt - run.startedAt,
    i18next.language
  );
  if (run.status === "blocked") {
    return i18next.t("terminal.runtimeControl.finishedDetailBlocked", {
      label,
      duration,
    });
  }
  if (run.status === "cancelled") {
    return i18next.t("terminal.runtimeControl.finishedDetailRanFor", {
      label,
      duration,
    });
  }
  const exitCode = run.nodes[run.rootTaskId]?.exitCode;
  if (run.status === "failed" && exitCode !== undefined) {
    return i18next.t("terminal.runtimeControl.finishedDetailFailed", {
      label,
      code: exitCode,
      duration,
    });
  }
  return i18next.t("terminal.runtimeControl.finishedDetailDuration", {
    label,
    duration,
  });
}

/**
 * 任务进入终态：消息型 toast（形态 B）+ 落消息中心（「查看详情」打开/聚焦对应面板）。
 * 按 runId 去重，避免 linger / 重渲染重复提示。
 */
export function notifyTaskRunFinishedIfNeeded(run: TaskRunControlEntry): void {
  if (isActiveTaskRunStatus(run.status)) {
    return;
  }
  if (notifiedRunIds.has(run.runId)) {
    return;
  }
  notifiedRunIds.add(run.runId);

  const label = taskRunLabel(run);
  const base = {
    actionParams: { runId: run.runId },
    actions: [
      { id: "open-output", labelKey: "terminal.runtimeControl.viewDetails" },
    ],
    body: taskRunDetail(run, label),
    dedupeKey: `task-run:${run.runId}`,
  };
  switch (run.status) {
    case "succeeded":
      systemNotify({
        ...base,
        kind: "task-run.finished",
        severity: "success",
        titleKey: "terminal.runtimeControl.finishedSuccess",
      });
      return;
    case "cancelled": {
      const forced = Object.values(run.nodes).some(
        (node) => node.termination === "force"
      );
      systemNotify({
        ...base,
        kind: "task-run.finished",
        severity: forced ? "error" : "info",
        titleKey: forced
          ? "terminal.runtimeControl.finishedForceCancelled"
          : "terminal.runtimeControl.finishedCancelled",
      });
      return;
    }
    case "blocked":
      systemNotify({
        ...base,
        kind: "task-run.finished",
        severity: "error",
        titleKey: "terminal.runtimeControl.finishedBlocked",
      });
      return;
    default:
      systemNotify({
        ...base,
        kind: "task-run.finished",
        severity: "error",
        titleKey: "terminal.runtimeControl.finishedFailed",
      });
  }
}

export function clearTaskRunFinishedNotificationsForTests(): void {
  notifiedRunIds.clear();
}
