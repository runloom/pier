import {
  isActiveTaskRunNodeStatus,
  selectedTaskOutputRunId,
} from "@shared/contracts/tasks.ts";
import i18next from "i18next";
import { useEffect } from "react";
import { taskOutputFromParams } from "@/panel-kits/terminal/terminal-panel-params.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { requestTerminalWebFocus } from "@/stores/terminal-input-routing-slice.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const IME_PENDING_KEYCODE = 229;

function isDismissKey(event: KeyboardEvent): boolean {
  if (event.isComposing === true || event.keyCode === IME_PENDING_KEYCODE) {
    return false;
  }
  switch (event.key) {
    case "Meta":
    case "Control":
    case "Alt":
    case "Shift":
      return false;
    default:
      return true;
  }
}

/**
 * Task output 在任务结束后保留 panel 供查看；SURFACE_CLOSE 会被忽略（见
 * useTerminalSurfaceClose）。当本 panel 激活且 run 已终态时，接管键盘，
 * 任意实键关闭 panel，对齐 Ghostty "Press any key to close" 文案。
 */
export function useTaskOutputKeyDismiss(
  panelId: string,
  params: unknown,
  isActive: boolean
): void {
  const taskOutput = taskOutputFromParams(params);
  const runId = taskOutput ? selectedTaskOutputRunId(taskOutput) : null;
  const taskId = taskOutput?.taskId ?? null;
  const runFinished = useTaskRunsStore((state) => {
    if (!(runId && taskId)) {
      return false;
    }
    const run = state.snapshot.runs[runId];
    if (!run) {
      return false;
    }
    const status = run.nodes[taskId]?.status ?? run.status;
    return !isActiveTaskRunNodeStatus(status);
  });

  useEffect(() => {
    if (!(runId && taskId && isActive && runFinished)) {
      return;
    }

    const releaseWebFocus = requestTerminalWebFocus(
      `task-output-dismiss:${panelId}`
    );

    const close = () => {
      useWorkspaceStore
        .getState()
        .closePanel(panelId)
        .catch((err: unknown) => {
          showAppAlert({
            body: err instanceof Error ? err.message : String(err),
            title: i18next.t("terminal.closeFailed"),
          });
        });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isDismissKey(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      releaseWebFocus();
    };
  }, [isActive, panelId, runFinished, runId, taskId]);
}
