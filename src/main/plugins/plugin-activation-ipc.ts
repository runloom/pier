import { managedPluginRendererActivationReportSchema } from "@shared/contracts/managed-plugin.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { ipcMain } from "electron";
import type { ManagedPluginInstallService } from "../services/managed-plugins/install-service.ts";
import { windowManager } from "../windows/window-manager.ts";

export function registerPluginActivationIpc(
  service: ManagedPluginInstallService
): void {
  ipcMain.handle(
    PIER.PLUGIN_RENDERER_ACTIVATION_REPORT,
    async (event, rawPayload: unknown) => {
      if (event.senderFrame !== event.sender.mainFrame) {
        throw new Error(
          "plugin activation report sender is not the main frame"
        );
      }
      const window = windowManager.fromWebContents(event.sender);
      const windowId = window
        ? windowManager.findInternalIdByWindow(window)
        : null;
      if (!windowId) {
        throw new Error("plugin activation report sender is not a Pier window");
      }
      const payload =
        managedPluginRendererActivationReportSchema.parse(rawPayload);
      await service.recordActivationResult({
        ...(payload.error ? { error: payload.error } : {}),
        ok: payload.ok,
        phase: "renderer",
        pluginId: payload.pluginId,
        version: payload.version,
        windowId,
      });
    }
  );
}
