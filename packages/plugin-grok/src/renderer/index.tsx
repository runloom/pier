import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";
import type { ReactNode } from "react";
import { AccountsSettingsPage } from "./accounts-settings-page.tsx";
import rendererStyles from "./styles.css?inline";

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

    const disposeSettings = context.settingsPages.register({
      id: "pier.grok.accounts",
      component: () => (
        <GrokRendererRoot>
          <AccountsSettingsPage context={context} />
        </GrokRendererRoot>
      ),
    });
    return () => {
      disposeSettings();
      styleElement.remove();
    };
  },
};
