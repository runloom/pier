import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import i18next from "i18next";
import { toast } from "sonner";
import {
  openTaskRunOutput,
  revealTaskRun,
} from "@/lib/actions/task-run-operations.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

const notifiedRunIds = new Set<string>();

function isActiveTaskRunStatus(status: TaskRunControlEntry["status"]): boolean {
  return status === "pending" || status === "running" || status === "stopping";
}

function taskRunLabel(run: TaskRunControlEntry): string {
  return run.nodes[run.rootTaskId]?.label ?? run.rootTaskId;
}

function viewDetailsAction(run: TaskRunControlEntry): {
  label: string;
  onClick(): void;
} {
  const label = taskRunLabel(run);
  return {
    label: i18next.t("terminal.runtimeControl.viewDetails"),
    onClick: () => {
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
    },
  };
}

/**
 * 任务进入终态时发一次胶囊 toast；带「查看详情」打开/聚焦对应面板。
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
  const action = viewDetailsAction(run);
  switch (run.status) {
    case "succeeded":
      toast.success(
        i18next.t("terminal.runtimeControl.finishedSuccess", { label }),
        { action }
      );
      return;
    case "cancelled": {
      const forced = Object.values(run.nodes).some(
        (node) => node.termination === "force"
      );
      if (forced) {
        toast.error(
          i18next.t("terminal.runtimeControl.finishedForceCancelled", {
            label,
          }),
          { action }
        );
        return;
      }
      toast.success(
        i18next.t("terminal.runtimeControl.finishedCancelled", { label }),
        { action }
      );
      return;
    }
    case "blocked":
      toast.error(
        i18next.t("terminal.runtimeControl.finishedBlocked", { label }),
        { action }
      );
      return;
    default:
      toast.error(
        i18next.t("terminal.runtimeControl.finishedFailed", { label }),
        { action }
      );
  }
}

export function clearTaskRunFinishedNotificationsForTests(): void {
  notifiedRunIds.clear();
}
