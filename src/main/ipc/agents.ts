import type { AgentKind, DetectAgentsResult } from "@shared/contracts/agent.ts";
import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { createAgentDetectionService } from "../services/agents/agent-detection-service.ts";
import { resolveAgentLaunch } from "../services/agents/agent-launch.ts";
import { terminalLaunchRegistry } from "../state/terminal-launch-state.ts";

export function registerAgentsIpc(ipcMain: IpcMain): void {
  const detection = createAgentDetectionService();

  ipcMain.handle(
    "pier:agents:detect",
    (): Promise<DetectAgentsResult> => detection.detect()
  );

  ipcMain.handle(
    "pier:agents:refresh",
    (): Promise<DetectAgentsResult> => detection.refresh()
  );

  ipcMain.handle(
    "pier:agents:prepareLaunch",
    async (_e, agentId: AgentKind): Promise<{ launchId: string | null }> => {
      const prefs = await appCore.services.preferences.read();
      const launch = resolveAgentLaunch({
        agentId,
        override: prefs.agentCommandOverrides?.[agentId],
        agentDefaultArgs: prefs.agentDefaultArgs,
        agentDefaultEnv: prefs.agentDefaultEnv,
        agentPermissionMode: prefs.agentPermissionMode,
      });
      if (!launch) {
        return { launchId: null };
      }
      const launchId = terminalLaunchRegistry.register({ agentId, ...launch });
      return { launchId };
    }
  );
}
