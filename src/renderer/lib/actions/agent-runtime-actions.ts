import i18next from "i18next";
import { Bot, HandHelping, Users } from "lucide-react";
import { toast } from "sonner";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import { openCollaborationView } from "@/lib/agent-runtime/collaboration-dialog.tsx";
import { invokeAgentRuntimeFocus } from "@/lib/agent-runtime/focus-feedback.ts";
import { enrichAgentIndexEntriesWithLocalFa } from "@/lib/agent-runtime/index-display-status.ts";
import { nextNeedsYouEntry } from "@/lib/agent-runtime/next-needs-you.ts";
import { openAgentIndexQuickPick } from "@/lib/agent-runtime/open-agent-index-quickpick.tsx";
import { preferredAgentIndexSortOptions } from "@/lib/agent-runtime/preferred-sort-options.ts";
import { useAgentRuntimeIndexStore } from "@/stores/agent-runtime-index.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

export { openAgentIndexQuickPick } from "@/lib/agent-runtime/open-agent-index-quickpick.tsx";

async function handleListAgents(): Promise<void> {
  await openAgentIndexQuickPick();
}

/** Cycle Needs-you in renderer; notification clicks still use main “first”. */
async function handleFocusWaitingAgent(): Promise<void> {
  const entries = enrichAgentIndexEntriesWithLocalFa(
    useAgentRuntimeIndexStore.getState().entries,
    useForegroundActivityStore.getState().activities
  );
  const next = nextNeedsYouEntry(
    entries,
    useWorkspaceStore.getState().api?.activePanel?.id ?? null,
    preferredAgentIndexSortOptions()
  );
  if (!next) {
    await invokeAgentRuntimeFocus(async () => ({ status: "empty" }));
    return;
  }
  const activePanelId =
    useWorkspaceStore.getState().api?.activePanel?.id ?? null;
  if (next.panelId === activePanelId) {
    toast(i18next.t("agents.focusAlreadyCurrent"));
  }
  await invokeAgentRuntimeFocus(() =>
    window.pier.agentRuntimeIndex.focus(next.agentRef)
  );
}

function handleOpenCollaboration(): void {
  openCollaborationView();
}

export const AGENT_RUNTIME_ACTION_CONTRIBUTIONS: readonly ActionContribution[] =
  [
    {
      categoryKey: "run",
      group: "2_agents",
      handler: handleListAgents,
      iconComponent: Bot,
      id: "pier.agents.list",
      sortOrder: 10,
      surfaces: ["command-palette"],
      titleKey: "commandPalette.action.listAgents",
    },
    {
      categoryKey: "run",
      group: "2_agents",
      handler: handleOpenCollaboration,
      iconComponent: Users,
      id: "pier.agents.collaboration",
      sortOrder: 12,
      surfaces: ["command-palette"],
      titleKey: "commandPalette.action.openCollaboration",
    },
    {
      categoryKey: "run",
      group: "2_agents",
      handler: handleFocusWaitingAgent,
      iconComponent: HandHelping,
      id: "pier.agents.focusWaiting",
      sortOrder: 11,
      surfaces: ["command-palette"],
      titleKey: "agents.quickPick.focusNextNeedsYou",
    },
  ];

export function registerAgentRuntimeActions(): () => void {
  const disposers = registerActionContributions(
    AGENT_RUNTIME_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
