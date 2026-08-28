import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";
import type { ReactNode } from "react";
import { AccountsSettingsPage } from "./accounts-settings-page.tsx";
import rendererStyles from "./styles.css?inline";

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

    const disposeSettings = context.settingsPages.register({
      id: "pier.codex.accounts",
      component: () => (
        <CodexRendererRoot>
          <AccountsSettingsPage context={context} />
        </CodexRendererRoot>
      ),
    });
    return () => {
      disposeSettings();
      styleElement.remove();
    };
  },
};
