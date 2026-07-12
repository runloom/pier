import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";
import type { ReactNode } from "react";
import { AccountsSettingsPage } from "./accounts-settings-page.tsx";
import { AccountsWidget as AccountsWidgetImpl } from "./accounts-widget.tsx";
import { CostWidget as CostWidgetImpl } from "./cost-widget.tsx";
import rendererStyles from "./styles.css?inline";

/**
 * Codex plugin renderer entry (plan Task 10).
 */

export { AccountsWidget } from "./accounts-widget.tsx";
export { CostWidget } from "./cost-widget.tsx";

function CodexRendererRoot({ children }: { children: ReactNode }) {
  return (
    <div className="contents" data-pier-codex-scope="">
      {children}
    </div>
  );
}

export const plugin: ExternalRendererPluginModule = {
  id: "pier.codex",
  activate(context: ExternalRendererPluginContext): () => void {
    const styleElement = document.createElement("style");
    styleElement.dataset.pluginId = "pier.codex";
    styleElement.textContent = rendererStyles;
    document.head.appendChild(styleElement);

    const disposeAccountsWidget = context.missionControlWidgets.register({
      id: "pier.codex.accounts",
      component: (props) => (
        <CodexRendererRoot>
          <AccountsWidgetImpl context={context} {...props} />
        </CodexRendererRoot>
      ),
    });
    const disposeCostWidget = context.missionControlWidgets.register({
      id: "pier.codex.cost",
      component: (props) => (
        <CodexRendererRoot>
          <CostWidgetImpl context={context} {...props} />
        </CodexRendererRoot>
      ),
    });
    const disposeSettings = context.settingsPages.register({
      id: "pier.codex.accounts",
      component: () => (
        <CodexRendererRoot>
          <AccountsSettingsPage context={context} />
        </CodexRendererRoot>
      ),
    });
    return () => {
      disposeAccountsWidget();
      disposeCostWidget();
      disposeSettings();
      styleElement.remove();
    };
  },
};
