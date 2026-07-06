import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import { KeyRound } from "lucide-react";
import { CODEX_ACCOUNTS_WIDGET_ID, CODEX_PLUGIN_ID } from "../manifest.ts";
import { registerCodexActions } from "./account-actions.ts";
import { createAccountsWidget } from "./accounts-widget.tsx";

function registerCodexPluginContributions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerCodexActions(context),
    context.dashboardWidgets.register({
      component: createAccountsWidget(context),
      icon: KeyRound,
      id: CODEX_ACCOUNTS_WIDGET_ID,
      title: () =>
        context.i18n.t("widget.accounts.title", undefined, "Codex Accounts"),
    }),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

export const codexRendererPlugin: RendererPluginModule = {
  activate: (context) => registerCodexPluginContributions(context),
  icon: KeyRound,
  id: CODEX_PLUGIN_ID,
};
