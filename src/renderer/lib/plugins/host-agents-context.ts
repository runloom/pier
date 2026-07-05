import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { pickAgent } from "@shared/agent-selection.ts";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";

export function createPluginAgentsContext(): RendererPluginContext["agents"] {
  return {
    async selection() {
      await useAgentDetectStore.getState().ensureDetected();
      const detectedIds = useAgentDetectStore.getState().detectedIds;
      const { defaultAgentId, disabledAgentIds } =
        useAgentPreferencesStore.getState();
      const disabled = new Set(disabledAgentIds);
      const enabledIds = detectedIds.filter((id) => !disabled.has(id));
      return {
        detectedIds: [...detectedIds],
        enabledIds,
        selectedId: pickAgent(defaultAgentId, detectedIds, disabledAgentIds),
      };
    },
  };
}
