import i18next from "i18next";
import { useEffect } from "react";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

export function useTerminalSurfaceClose(panelId: string): void {
  useEffect(
    () =>
      window.pier.terminal.onSurfaceCloseRequest((request) => {
        if (request.panelId !== panelId) {
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
      }),
    [panelId]
  );
}
