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
 *
 * 退出码保留在详情而非标题：Pier 是开发工作台，脚本失败码是领域信息；
 * 标题仍说「任务失败」，不把实现词推到第一眼。
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

function hasTermination(
  run: TaskRunControlEntry,
  termination: "force" | "interrupt" | "superseded"
): boolean {
  return Object.values(run.nodes).some(
    (node) => node.termination === termination
  );
}

/**
 * 用户明确要求的优雅停止（点停止 / 关面板确认后的 stop）。
 * 不含 force：强制停止仍需 error 级完成信号。
 */
function isUserRequestedGracefulStop(run: TaskRunControlEntry): boolean {
  if (hasTermination(run, "force")) {
    return false;
  }
  return Object.values(run.nodes).some(
    (node) =>
      node.termination === "interrupt" || node.stopRequestedAt !== undefined
  );
}

function cancelledTitleKey(run: TaskRunControlEntry): {
  severity: "error" | "info";
  titleKey: string;
} {
  if (hasTermination(run, "force")) {
    return {
      severity: "error",
      titleKey: "terminal.runtimeControl.finishedForceCancelled",
    };
  }
  // 理论上 graceful user-stop 已在上方静默；兜底仍用「已停止」对齐按钮语义。
  if (isUserRequestedGracefulStop(run)) {
    return {
      severity: "info",
      titleKey: "terminal.runtimeControl.finishedStopped",
    };
  }
  return {
    severity: "info",
    titleKey: "terminal.runtimeControl.finishedCancelled",
  };
}

/**
 * 后台任务进入业务终态：消息型 toast + 消息中心。
 *
 * ## 金标准（意图级通知，不是状态机边通知）
 *
 * | 维度 | 规则 | 原因 |
 * |------|------|------|
 * | 谁收得到 | 仅 `mode === "background"` | 前台终端有输出/tab/控制条退场等强自然 UI；设置文案也是「后台任务完成时弹出」。对齐 VS Code「离开视线才提醒」精神，用 mode 作稳定代理（不做未配置的焦点启发式）。 |
 * | 重新运行 | `superseded` 静默 | 旧 run 取消是 restart 实现细节，用户意图是「再跑」。 |
 * | 用户优雅停止 | interrupt / stopRequestedAt 静默（force 除外） | 点停止或关面板已确认即强意图+控制条退场；再弹「已停止」是双反馈。 |
 * | 强制停止 | 发 error | 破坏性、异步杀进程，需要完成信号（即使曾走过 stopRequestedAt）。 |
 * | 成功/失败/阻塞 | 后台一律发 | 设置承诺「完成时弹出」；短任务噪音由用户静音 kind，不用暗阈值。 |
 * | 意外取消 | 发 info「已取消」 | 非用户 stop 路径的中止，需要知道。 |
 *
 * 按 runId 去重，避免重渲染重复提示。
 */
export function notifyTaskRunFinishedIfNeeded(run: TaskRunControlEntry): void {
  if (isActiveTaskRunStatus(run.status)) {
    return;
  }
  if (notifiedRunIds.has(run.runId)) {
    return;
  }

  // 前台终端任务：结果由面板与 tab 状态承接，不进 task-run.finished。
  if (run.mode !== "background") {
    notifiedRunIds.add(run.runId);
    return;
  }

  // 重新运行顶掉旧实例 / 用户优雅停止：不写系统消息（含消息中心）。
  if (
    run.status === "cancelled" &&
    (hasTermination(run, "superseded") || isUserRequestedGracefulStop(run))
  ) {
    notifiedRunIds.add(run.runId);
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
      const cancelled = cancelledTitleKey(run);
      systemNotify({
        ...base,
        kind: "task-run.finished",
        severity: cancelled.severity,
        titleKey: cancelled.titleKey,
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
