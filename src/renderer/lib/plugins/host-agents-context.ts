import type { RendererPluginContext } from "@plugins/api/renderer.ts";
export function createPluginAgentsContext(): RendererPluginContext["agents"] {
  return {
    selection: () => window.pier.agents.selection(),
  };
}
