import { Bot, HandHelping } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import { invokeAgentRuntimeFocusWaiting } from "@/lib/agent-runtime/focus-feedback.ts";
import { openAgentIndexQuickPick } from "@/lib/agent-runtime/open-agent-index-quickpick.tsx";
import { preferredAgentIndexSortOptions } from "@/lib/agent-runtime/preferred-sort-options.ts";

export { openAgentIndexQuickPick } from "@/lib/agent-runtime/open-agent-index-quickpick.tsx";

async function handleListAgents(): Promise<void> {
  await openAgentIndexQuickPick();
}

/** L4 零选择：不进命令面板 / 不嵌列表假行，仅快捷键绑定。 */
async function handleFocusWaitingAgent(): Promise<void> {
  await invokeAgentRuntimeFocusWaiting(preferredAgentIndexSortOptions());
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
      handler: handleFocusWaitingAgent,
      iconComponent: HandHelping,
      id: "pier.agents.focusWaiting",
      sortOrder: 11,
      surfaces: [],
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
