import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  type AgentLifecycleService,
  createAgentLifecycleService,
} from "../services/agents/lifecycle/service.ts";
import type { PreferencesService } from "../services/preferences-service.ts";
import { broadcastAgentLifecycleProgress } from "./window-broadcasts.ts";

export function createBootedAgentLifecycleService(options: {
  waitForHostEnv: () => Promise<void>;
  getEnv: () => Promise<NodeJS.ProcessEnv>;
  preferences: PreferencesService;
  refreshDetection: () => Promise<void>;
}): AgentLifecycleService {
  return createAgentLifecycleService({
    waitForHostEnv: options.waitForHostEnv,
    getEnv: options.getEnv,
    getLifecycleCommands: async () => {
      const prefs = await options.preferences.read();
      // Only update is user-overridable; install/uninstall always use project specs.
      return {
        install: {},
        update: prefs.agentUpdateCommands ?? {},
        uninstall: {},
      };
    },
    onProgress: broadcastAgentLifecycleProgress,
    refreshDetection: options.refreshDetection,
    afterInstall: async (agentId: AgentKind) => {
      try {
        const prefs = await options.preferences.read();
        if (!prefs.agentStatusHooks) {
          return;
        }
        const { getAgentHookIntegration } = await import(
          "../services/agents/integrations/registry.ts"
        );
        const integration = getAgentHookIntegration(agentId);
        if (!integration?.detect()) {
          return;
        }
        await integration.install();
      } catch (err) {
        console.warn(
          `[agent-lifecycle] afterInstall hooks failed for ${agentId}`,
          err
        );
      }
    },
    afterUninstall: async (agentId: AgentKind) => {
      try {
        const { getAgentHookIntegration } = await import(
          "../services/agents/integrations/registry.ts"
        );
        const integration = getAgentHookIntegration(agentId);
        // No detect gate — align with uninstallAllAgentHooks.
        if (integration) {
          await integration.uninstall();
        }
      } catch (err) {
        console.warn(
          `[agent-lifecycle] afterUninstall hooks failed for ${agentId}`,
          err
        );
      }
      const prefs = await options.preferences.read();
      const disabledAgentIds = prefs.disabledAgentIds.filter(
        (id) => id !== agentId
      );
      const defaultAgentId =
        prefs.defaultAgentId === agentId ? null : prefs.defaultAgentId;
      if (
        disabledAgentIds.length !== prefs.disabledAgentIds.length ||
        defaultAgentId !== prefs.defaultAgentId
      ) {
        await options.preferences.update({ disabledAgentIds, defaultAgentId });
      }
      // Keep agent*Commands overrides so reinstall can reuse them.
    },
  });
}
