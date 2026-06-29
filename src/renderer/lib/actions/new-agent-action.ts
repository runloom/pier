import { pickAgent } from "@shared/agent-selection.ts";
import i18next from "i18next";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import type { ActionContribution } from "./contribution-types.ts";

async function handleNewAgent(): Promise<void> {
  const { detectedIds } = useAgentDetectStore.getState();
  const { defaultAgentId, disabledAgentIds } =
    useAgentPreferencesStore.getState();

  const agentId = pickAgent(defaultAgentId, detectedIds, disabledAgentIds);
  if (!agentId) {
    toast.error(i18next.t("commandPalette.agents.noAgentDetected"));
    return;
  }

  const { launchId } = await window.pier.agents.prepareLaunch(agentId);
  if (!launchId) {
    return;
  }

  useWorkspaceStore.getState().addTerminal({ launchId });
}

export const NEW_AGENT_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  {
    aliasesKey: "commandPalette.aliases.newAgent",
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
