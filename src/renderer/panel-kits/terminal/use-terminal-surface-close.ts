import i18next from "i18next";
import { useEffect } from "react";
import { requestTaskOutputSurfaceClose } from "@/lib/actions/task-output-run-operations.ts";
import { taskOutputFromParams } from "@/panel-kits/terminal/terminal-panel-params.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

/**
 * Ghostty 在进程退出后保留 surface，提示 "Press any key to close"。
 * 用户按键后的 close-surface → SURFACE_CLOSE_REQUEST → 这里关 panel。
 *
 * Task output 例外：`finishTerminalOutput` 会立刻触发一次 process-closed/
 * SURFACE_CLOSE，若在此关闭会让用户无法查看终态输出。Task output 的按键
 * 关闭走 `useTaskOutputKeyDismiss`。
 */
export function useTerminalSurfaceClose(
  panelId: string,
  params?: unknown
): void {
  const isTaskOutputPanel = Boolean(taskOutputFromParams(params));

  useEffect(
    () =>
      window.pier.terminal.onSurfaceCloseRequest((request) => {
        if (request.panelId !== panelId) {
          return;
        }
        requestTaskOutputSurfaceClose(panelId, () => {
          if (isTaskOutputPanel) {
            return;
          }
          useWorkspaceStore
            .getState()
            .closePanel(panelId)
            .catch((err: unknown) => {
              showAppAlert({
                body: err instanceof Error ? err.message : String(err),
                title: i18next.t("terminal.closeFailed"),
              });
            });
        });
      }),
    [isTaskOutputPanel, panelId]
  );
}
