import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";
import type { ReactNode } from "react";
import { AccountsSettingsPage } from "./accounts-settings-page.tsx";
import rendererStyles from "./styles.css?inline";

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

    const disposeSettings = context.settingsPages.register({
      id: "pier.claude.accounts",
      component: () => (
        <ClaudeRendererRoot>
          <AccountsSettingsPage context={context} />
        </ClaudeRendererRoot>
      ),
    });
    return () => {
      disposeSettings();
      styleElement.remove();
    };
  },
};
