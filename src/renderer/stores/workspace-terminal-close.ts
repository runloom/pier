import { clearTerminalRelaunchRequest } from "@/stores/terminal-relaunch.store.ts";

export function closeNativeTerminalPanel(panelId: string): void {
  clearTerminalRelaunchRequest(panelId);
  window.pier?.terminal?.close?.(panelId)?.catch((err: unknown) => {
    console.error(`[workspace] close terminal ${panelId} failed:`, err);
  });
}
