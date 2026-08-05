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
      return {
        install: prefs.agentInstallCommands ?? {},
        update: prefs.agentUpdateCommands ?? {},
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
  });
}
