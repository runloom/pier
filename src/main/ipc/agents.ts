import { rankAgents } from "@shared/agent-selection.ts";
import type { AgentKind, DetectAgentsResult } from "@shared/contracts/agent.ts";
import type { AgentSelectionResult } from "@shared/contracts/agent-usage.ts";
import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { resolveAgentLaunch } from "../services/agents/agent-launch.ts";
import { terminalLaunchRegistry } from "../state/terminal-launch-state.ts";

export function registerAgentsIpc(ipcMain: IpcMain): void {
  const detection = appCore.services.agentDetection;

  ipcMain.handle(
    "pier:agents:detect",
    (): Promise<DetectAgentsResult> => detection.detect()
  );

  ipcMain.handle(
    "pier:agents:refresh",
    (): Promise<DetectAgentsResult> => detection.refresh()
  );

  ipcMain.handle(
    "pier:agents:selection",
    async (): Promise<AgentSelectionResult> => {
      const [{ detectedIds }, preferences, usage] = await Promise.all([
        detection.detect(),
        appCore.services.preferences.read(),
        appCore.services.agentUsage.read(),
      ]);
      const disabled = new Set(preferences.disabledAgentIds);
      const enabledIds = detectedIds.filter((id) => !disabled.has(id));
      const rankedIds = rankAgents({
        detected: detectedIds,
        disabled: preferences.disabledAgentIds,
        now: Date.now(),
        preferred: preferences.defaultAgentId,
        usage: usage.entries,
      });
      return {
        detectedIds,
        enabledIds,
        rankedIds,
        selectedId:
          preferences.defaultAgentId === "blank"
            ? null
            : (rankedIds[0] ?? null),
      };
    }
  );

  ipcMain.handle(
    "pier:agents:prepareLaunch",
    async (_e, agentId: AgentKind): Promise<{ launchId: string | null }> => {
      const prefs = await appCore.services.preferences.read();
      if (prefs.disabledAgentIds?.includes(agentId)) {
        return { launchId: null };
      }
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

  ipcMain.handle(
    "pier:agents:prepareLaunchFromSpec",
    async (
      _e,
      spec: {
        agentId: AgentKind;
        command?: string;
        cwd?: string;
      }
    ): Promise<{ launchId: string | null }> => {
      const prefs = await appCore.services.preferences.read();
      if (prefs.disabledAgentIds?.includes(spec.agentId)) {
        return { launchId: null };
      }

      const command =
        typeof spec.command === "string" && spec.command.trim().length > 0
          ? spec.command
          : resolveAgentLaunch({
              agentId: spec.agentId,
              override: prefs.agentCommandOverrides?.[spec.agentId],
              agentDefaultArgs: prefs.agentDefaultArgs,
              agentDefaultEnv: prefs.agentDefaultEnv,
              agentPermissionMode: prefs.agentPermissionMode,
            })?.command;

      if (!command) {
        return { launchId: null };
      }

      const launchId = terminalLaunchRegistry.register({
        agentId: spec.agentId,
        command,
        ...(typeof spec.cwd === "string" && spec.cwd.trim().length > 0
          ? { cwd: spec.cwd }
          : {}),
      });
      return { launchId };
    }
  );
}
