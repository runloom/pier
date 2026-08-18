import { rankAgents } from "@shared/agent-selection.ts";
import type {
  AgentLifecycleAction,
  AgentLifecycleActionResult,
} from "@shared/contracts/agent/lifecycle.ts";
import type { AgentSelectionResult } from "@shared/contracts/agent/usage.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { IpcMain } from "electron";
import { appCore } from "../app-core/index.ts";
import { resolveAgentLaunch } from "../services/agents/launch.ts";
import { wrapAndRegisterLaunch } from "../services/terminal-launch-wrap/index.ts";
import { terminalLaunchRegistry } from "../state/terminal-launch-state.ts";

export function registerAgentsIpc(ipcMain: IpcMain): void {
  const detection = appCore.services.agentDetection;
  const lifecycle = appCore.services.agentLifecycle;

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
      const launchId = await wrapAndRegisterLaunch(
        { agentId, ...launch },
        (next) => terminalLaunchRegistry.register(next)
      );
      return { launchId };
    }
  );

  ipcMain.handle(
    "pier:agents:lifecycle:run",
    async (
      _e,
      payload: { agentId: AgentKind; action: AgentLifecycleAction }
    ): Promise<AgentLifecycleActionResult> => {
      if (!lifecycle) {
        return {
          action: payload.action,
          agentId: payload.agentId,
          ok: false,
          errorCode: "unavailable" as const,
        };
      }
      return lifecycle.run(payload.agentId, payload.action);
    }
  );

  ipcMain.handle(
    "pier:agents:lifecycle:runMany",
    async (
      _e,
      payload: {
        agentIds: AgentKind[];
        action: AgentLifecycleAction;
      }
    ): Promise<AgentLifecycleActionResult[]> => {
      if (!lifecycle) {
        return payload.agentIds.map((agentId) => ({
          action: payload.action,
          agentId,
          ok: false,
          errorCode: "unavailable" as const,
        }));
      }
      return lifecycle.runMany(payload.agentIds, payload.action);
    }
  );

  ipcMain.handle(
    "pier:agents:lifecycle:cancel",
    async (
      _e,
      payload: { agentId?: AgentKind; runId?: string }
    ): Promise<boolean> => {
      if (!lifecycle) {
        return false;
      }
      if (payload.agentId) {
        return lifecycle.cancel(payload.agentId);
      }
      if (payload.runId) {
        return lifecycle.cancelRun(payload.runId);
      }
      return false;
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

      const launchId = await wrapAndRegisterLaunch(
        {
          agentId: spec.agentId,
          command,
          ...(typeof spec.cwd === "string" && spec.cwd.trim().length > 0
            ? { cwd: spec.cwd }
            : {}),
        },
        (next) => terminalLaunchRegistry.register(next)
      );
      return { launchId };
    }
  );
}
