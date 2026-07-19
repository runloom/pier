import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";
import type { ReactNode } from "react";
import { HostsSettingsPage } from "./hosts-settings-page.tsx";
import { openSshTerminalPicker } from "./open-host-terminal.tsx";
import rendererStyles from "./styles.css?inline";
import { formatUnknownError, type Translate } from "./translate.ts";

function SshRendererRoot({ children }: { children: ReactNode }) {
  return (
    <div className="contents" data-pier-ssh-scope="">
      {children}
    </div>
  );
}

export const plugin: ExternalRendererPluginModule = {
  id: "pier.ssh",
  activate(context: ExternalRendererPluginContext): () => void {
    const styleElement = document.createElement("style");
    styleElement.dataset.pluginId = "pier.ssh";
    styleElement.textContent = rendererStyles;
    document.head.appendChild(styleElement);

    const t: Translate = (key, fallback) => context.i18n.t(key, fallback);
    const reportError = (error: unknown): void => {
      context.dialogs
        .alert({
          body: formatUnknownError(error),
          title: t(
            "pier.ssh.hosts.settings.actionFailed",
            "SSH host action failed"
          ),
        })
        .catch(() => undefined);
    };

    const disposeAction = context.actions.register({
      category: "terminal",
      id: "pier.ssh.openTerminal",
      invoke: () => openSshTerminalPicker({ context, onError: reportError, t }),
      title: () => t("pier.ssh.openTerminal.title", "Open SSH Terminal"),
    });
    const disposeSettings = context.settingsPages.register({
      id: "pier.ssh.hosts",
      component: () => (
        <SshRendererRoot>
          <HostsSettingsPage context={context} />
        </SshRendererRoot>
      ),
    });
    return () => {
      disposeAction();
      disposeSettings();
      styleElement.remove();
    };
  },
};
