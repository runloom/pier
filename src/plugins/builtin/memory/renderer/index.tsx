import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import { Brain } from "lucide-react";
import { MEMORY_PANEL_ID, MEMORY_PLUGIN_ID } from "../manifest.ts";
import { createMemoryPanel } from "./panel.tsx";

export function registerMemoryPluginContributions(
  context: RendererPluginContext
): () => void {
  return context.panels.register({
    component: createMemoryPanel(context),
    icon: Brain,
    id: MEMORY_PANEL_ID,
    kind: "web",
    title: () => context.i18n.t("panel.title", undefined, "Project Memory"),
  });
}

export const memoryRendererPlugin: RendererPluginModule = {
  activate: (context) => registerMemoryPluginContributions(context),
  icon: Brain,
  id: MEMORY_PLUGIN_ID,
};
