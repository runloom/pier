import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import { Brain } from "lucide-react";
import { MEMORY_PLUGIN_ID, MEMORY_PROJECT_SETTINGS_ID } from "../manifest.ts";
import { MemorySettingsDetail } from "./settings-detail.tsx";

export function registerMemoryPluginContributions(
  context: RendererPluginContext
): () => void {
  return context.projectSettings.register({
    id: MEMORY_PROJECT_SETTINGS_ID,
    render: ({ projectRootPath }) => (
      <MemorySettingsDetail
        context={context}
        projectRootPath={projectRootPath}
      />
    ),
    title: () => context.i18n.t("page.title", undefined, "Project Memory"),
    visible: ({ isPierHome }) => !isPierHome,
  });
}

export const memoryRendererPlugin: RendererPluginModule = {
  activate: (context) => registerMemoryPluginContributions(context),
  icon: Brain,
  id: MEMORY_PLUGIN_ID,
};
