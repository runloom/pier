import type { ExternalRendererPluginModule } from "@pier/plugin-api/renderer";
import { PLUGIN_ID } from "../main/settings-keys.ts";

export const plugin: ExternalRendererPluginModule = {
  id: PLUGIN_ID,
  activate() {
    // 设置面由宿主自动表单渲染（manifest.configuration + settingsPages 声明）。
    return () => undefined;
  },
};
