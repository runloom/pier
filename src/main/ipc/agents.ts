import type { DetectAgentsResult } from "@shared/contracts/agent.ts";
import type { IpcMain } from "electron";
import { createAgentDetectionService } from "../services/agents/agent-detection-service.ts";

export function registerAgentsIpc(ipcMain: IpcMain): void {
  const detection = createAgentDetectionService();
  ipcMain.handle(
    "pier:agents:detect",
    (): Promise<DetectAgentsResult> => detection.detect()
  );
}
