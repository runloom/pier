import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";
import { AccountsSettingsPage } from "./accounts-settings-page.tsx";
import { AccountsWidget as AccountsWidgetImpl } from "./accounts-widget.tsx";

/**
 * Codex plugin renderer entry (plan Task 10).
 */

export { AccountsWidget } from "./accounts-widget.tsx";

export const plugin: ExternalRendererPluginModule = {
  id: "pier.codex",
  activate(context: ExternalRendererPluginContext): () => void {
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
    };
  },
};
