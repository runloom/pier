import { pickAgent } from "@shared/agent-selection.ts";
import i18next from "i18next";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { captureAnchoredTerminalTarget } from "@/stores/workspace-panel-helpers.ts";
import { startAgentInAnchoredTerminal } from "./agent-start-actions.ts";
import { registerActionContributions } from "./contribution-runtime.ts";
import type { ActionContribution } from "./contribution-types.ts";
import { rendererActionContributionRuntime } from "./renderer-action-runtime.ts";
import type { ActionInvocation } from "./types.ts";

function currentDefaultAgentId() {
  const { detectedIds } = useAgentDetectStore.getState();
  const { defaultAgentId, disabledAgentIds } =
    useAgentPreferencesStore.getState();
  return pickAgent(defaultAgentId, detectedIds, disabledAgentIds);
}

async function handleNewAgent(invocation?: ActionInvocation): Promise<void> {
  const target = captureAnchoredTerminalTarget(
    useWorkspaceStore.getState().api,
    invocation
  );
  // Startup kicks this off globally; this remains a cheap safety net for tests,
  // debug windows, or early invocations that race the initial probe.
  try {
    await useAgentDetectStore.getState().ensureDetected();
  } catch (error) {
    await showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: i18next.t("workspace.addPanelMenu.detectAgentsFailed"),
    });
    return;
  }

  const agentId = currentDefaultAgentId();
  if (!agentId) {
    toast.error(i18next.t("commandPalette.agents.noAgentDetected"));
    return;
  }

  await startAgentInAnchoredTerminal(agentId, target);
}

export const NEW_AGENT_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  {
    categoryKey: "run",
    group: "1_new",
    handler: handleNewAgent,
    iconComponent: Bot,
    id: "pier.agent.new",
    sortOrder: 2,
    // 默认智能体动作只作为稳定的快捷键入口存在。可见菜单中的快捷键
    // 标识由当前默认智能体对应的 pier.agent.start.<id> 动作借用，避免
    // 与该动作重复显示成两个启动项。
    surfaces: [],
    titleKey: "commandPalette.action.newAgent",
    when: "workspace.hasApi",
  },
];

export function registerNewAgentAction(): () => void {
  const disposers = registerActionContributions(
    NEW_AGENT_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
