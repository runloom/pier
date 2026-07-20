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

function ClaudeRendererRoot({ children }: { children: ReactNode }) {
  return (
    <div className="contents" data-pier-claude-scope="">
      {children}
    </div>
  );
}

export const plugin: ExternalRendererPluginModule = {
  id: "pier.claude",
  activate(context: ExternalRendererPluginContext): () => void {
    const styleElement = document.createElement("style");
    styleElement.dataset.pluginId = "pier.claude";
    styleElement.textContent = rendererStyles;
    document.head.appendChild(styleElement);

    const disposeAccountsWidget = context.workbenchWidgets.register({
      id: "pier.claude.accounts",
      actions: (actionContext) => accountsWidgetActions(context, actionContext),
      component: (props) => (
        <ClaudeRendererRoot>
          <AccountsWidgetImpl context={context} {...props} />
        </ClaudeRendererRoot>
      ),
    });
    const disposeSettings = context.settingsPages.register({
      id: "pier.claude.accounts",
      component: () => (
        <ClaudeRendererRoot>
          <AccountsSettingsPage context={context} />
        </ClaudeRendererRoot>
      ),
    });
    return () => {
      disposeAccountsWidget();
      disposeSettings();
      styleElement.remove();
    };
  },
};
