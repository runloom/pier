import i18next from "i18next";
import { useEffect, useRef } from "react";
import { requestTaskOutputSurfaceClose } from "@/lib/actions/task-output-run-operations.ts";
import { shouldRetainTaskResultPanel } from "@/panel-kits/terminal/should-retain-task-result-panel.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

/**
 * Ghostty 进程退出后的 close-surface → SURFACE_CLOSE_REQUEST。
 * 普通 shell 关 panel；任务结果 panel（前台 task / Task Output）保留，
 * 由控制条「关闭」或用户关 tab 收口。
 */
export function useTerminalSurfaceClose(
  panelId: string,
  params?: unknown,
  options?: { hasAgentSession?: boolean | undefined }
): void {
  const activityKind = useForegroundActivityStore(
    (s) => s.activities[panelId]?.kind
  );
  const latchedAgentRef = useRef(false);
  const latchPanelIdRef = useRef(panelId);
  useEffect(() => {
    if (latchPanelIdRef.current !== panelId) {
      latchPanelIdRef.current = panelId;
      latchedAgentRef.current = activityKind === "agent";
      return;
    }
    if (activityKind === "agent") {
      latchedAgentRef.current = true;
    }
  }, [activityKind, panelId]);

  useEffect(
    () =>
      window.pier.terminal.onSurfaceCloseRequest((request) => {
        if (request.panelId !== panelId) {
          return;
        }
        requestTaskOutputSurfaceClose(panelId, () => {
          if (
            shouldRetainTaskResultPanel(panelId, params, {
              hasAgentActivity: latchedAgentRef.current,
              hasAgentSession: options?.hasAgentSession,
            })
          ) {
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
    [options?.hasAgentSession, panelId, params]
  );
}
