import { clearTaskRunSelectionForPanel } from "@/stores/task-run-selection.store.ts";
import { clearTerminalRelaunchRequest } from "@/stores/terminal-relaunch.store.ts";

export function closeNativeTerminalPanel(panelId: string): void {
  clearTerminalRelaunchRequest(panelId);
  clearTaskRunSelectionForPanel(panelId);
  window.pier?.terminal?.close?.(panelId)?.catch((err: unknown) => {
    console.error(`[workspace] close terminal ${panelId} failed:`, err);
  });
}
