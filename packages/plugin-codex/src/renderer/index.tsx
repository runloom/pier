import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";
import { AccountsSettingsPage } from "./accounts-settings-page.tsx";
import { AccountsWidget as AccountsWidgetImpl } from "./accounts-widget.tsx";
import rendererStyles from "./styles.css?inline";

/**
 * Codex plugin renderer entry (plan Task 10).
 */

export { AccountsWidget } from "./accounts-widget.tsx";

export const plugin: ExternalRendererPluginModule = {
  id: "pier.codex",
  activate(context: ExternalRendererPluginContext): () => void {
    const styleElement = document.createElement("style");
    styleElement.dataset.pluginId = "pier.codex";
    styleElement.textContent = rendererStyles;
    document.head.appendChild(styleElement);

    const disposeWidget = context.missionControlWidgets.register({
      id: "pier.codex.accounts",
      component: (props) => AccountsWidgetImpl({ context, ...props }),
    });
    const disposeSettings = context.settingsPages.register({
      id: "pier.codex.accounts",
      component: () => AccountsSettingsPage({ context }),
    });
    return () => {
      disposeWidget();
      disposeSettings();
      styleElement.remove();
    };
  },
};
