import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";
import { AccountsWidget as AccountsWidgetImpl } from "./accounts-widget.tsx";

/**
 * Codex plugin renderer entry (plan Task 10).
 */

export { AccountsWidget } from "./accounts-widget.tsx";

export const plugin: ExternalRendererPluginModule = {
  id: "pier.codex",
  activate(context: ExternalRendererPluginContext): () => void {
    const dispose = context.dashboardWidgets.register({
      id: "pier.codex.accounts",
      title: () => "Codex Accounts",
      component: (_props) => AccountsWidgetImpl({ context }),
    });
    return dispose;
  },
};
