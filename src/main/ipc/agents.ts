import type { AgentKind, DetectAgentsResult } from "@shared/contracts/agent.ts";
import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { createAgentDetectionService } from "../services/agents/agent-detection-service.ts";
import { resolveAgentCommand } from "../services/agents/agent-launch.ts";

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
      const command = resolveAgentCommand({
        agentId,
        override: prefs.agentCommandOverrides?.[agentId],
        agentDefaultArgs: prefs.agentDefaultArgs,
      });
      if (!command) {
        return { launchId: null };
      }
      const launchId = await appCore.services.terminalLaunches.register({
        command,
      });
      return { launchId };
    }
  );
}
