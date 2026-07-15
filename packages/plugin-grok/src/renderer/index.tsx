import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";
import type { ReactNode } from "react";
import { AccountsSettingsPage } from "./accounts-settings-page.tsx";
import {
  AccountsWidget as AccountsWidgetImpl,
  accountsWidgetActions,
} from "./accounts-widget.tsx";
import rendererStyles from "./styles.css?inline";

export { AccountsWidget } from "./accounts-widget.tsx";

function GrokRendererRoot({ children }: { children: ReactNode }) {
  return (
    <div className="contents" data-pier-grok-scope="">
      {children}
    </div>
  );
}

export const plugin: ExternalRendererPluginModule = {
  id: "pier.grok",
  activate(context: ExternalRendererPluginContext): () => void {
    const styleElement = document.createElement("style");
    styleElement.dataset.pluginId = "pier.grok";
    styleElement.textContent = rendererStyles;
    document.head.appendChild(styleElement);

    const disposeAccountsWidget = context.workbenchWidgets.register({
      id: "pier.grok.accounts",
      // Custom async refresh action owns the header slot. Manifest must keep
      // refreshable=false so the host does not also inject host:refresh
      // (Codex pattern — two refresh icons is a UX bug).
      actions: (actionContext) => accountsWidgetActions(context, actionContext),
      component: (props) => (
        <GrokRendererRoot>
          <AccountsWidgetImpl context={context} {...props} />
        </GrokRendererRoot>
      ),
    });
    const disposeSettings = context.settingsPages.register({
      id: "pier.grok.accounts",
      component: () => (
        <GrokRendererRoot>
          <AccountsSettingsPage context={context} />
        </GrokRendererRoot>
      ),
    });
    return () => {
      disposeAccountsWidget();
      disposeSettings();
      styleElement.remove();
    };
  },
};
