import i18next from "i18next";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import type { ActionContribution } from "./contribution-types.ts";

async function handleNewAgent(): Promise<void> {
  try {
    const { selectedId: agentId } = await window.pier.agents.selection();
    if (!agentId) {
      toast.error(i18next.t("commandPalette.agents.noAgentDetected"));
      return;
    }

    const { launchId } = await window.pier.agents.prepareLaunch(agentId);
    if (!launchId) {
      toast.error(i18next.t("commandPalette.agents.unavailable"));
      return;
    }

    useWorkspaceStore.getState().addTerminal({ launchId });
  } catch (err) {
    await showAppAlert({
      body: err instanceof Error ? err.message : String(err),
      title: i18next.t("commandPalette.agents.launchFailed"),
    });
  }
}

export const NEW_AGENT_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  {
    categoryKey: "run",
    group: "1_new",
    handler: handleNewAgent,
    iconComponent: Bot,
    id: "pier.agent.new",
    sortOrder: 2,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.newAgent",
    when: "workspace.hasApi",
  },
];
