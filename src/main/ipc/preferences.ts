import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { applyAgentStatusHooksPreference } from "../services/agents/claude-hook-installer.ts";
import type { ProjectPreferences } from "../state/preferences.ts";

export function registerPreferencesIpc(ipcMain: IpcMain): void {
  ipcMain.handle("pier:preferences:read", async () =>
    appCore.services.preferences.read()
  );

  ipcMain.handle(
    "pier:preferences:update",
    async (_event, patch: Partial<ProjectPreferences>) => {
      const merged = await appCore.services.preferences.update(patch);
      if (patch.agentStatusHooks !== undefined) {
        applyAgentStatusHooksPreference(merged.agentStatusHooks).catch(
          (err) => {
            console.error("[preferences] agent hook install failed:", err);
          }
        );
      }
      return merged;
    }
  );
}
