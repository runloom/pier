/**
 * Dynamically registers one Action per detected-and-enabled agent, so each
 * agent is independently searchable, frecency-ranked, and keybindable — both
 * in the command palette and in the anchored create-menu.
 *
 * Registration reacts to agent-detect and agent-preferences store changes:
 * new detections register new actions; disabled or undetected agents are
 * unregistered. The `pier.agent.new` (default agent) action remains a
 * shortcut-only action; the selected agent's visible action borrows its
 * shortcut label.
 */

import {
  AGENT_CATALOG,
  getAgentCatalogAliases,
  getAgentCatalogEntry,
} from "@shared/agent-catalog.ts";
import { AGENT_AUTO_PICK_ORDER, pickAgent } from "@shared/agent-selection.ts";
import { AGENT_START_COMMAND_PREFIX } from "@shared/commands.ts";
import type { AgentCatalogEntry, AgentKind } from "@shared/contracts/agent.ts";
import i18next from "i18next";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import {
  captureAnchoredTerminalTarget,
  resolveAnchoredTerminalOptions,
} from "@/stores/workspace-panel-helpers.ts";
import { registerDynamicAction } from "./contribution-runtime.ts";
import type { Action, ActionInvocation } from "./types.ts";

function agentStartId(agentId: AgentKind): string {
  return `${AGENT_START_COMMAND_PREFIX}${agentId}`;
}

function startAgentSortOrder(agentId: AgentKind): number {
  const order = AGENT_AUTO_PICK_ORDER.indexOf(agentId);
  return 10 + (order >= 0 ? order : 99);
}

async function handleStartAgent(
  agentId: AgentKind,
  invocation?: ActionInvocation
): Promise<void> {
  const target = captureAnchoredTerminalTarget(
    useWorkspaceStore.getState().api,
    invocation
  );
  try {
    const { launchId } = await window.pier.agents.prepareLaunch(agentId);
    if (!launchId) {
      toast.error(i18next.t("workspace.addPanelMenu.startAgentFailed"));
      return;
    }
    const terminalOptions = resolveAnchoredTerminalOptions(
      useWorkspaceStore.getState().api,
      target
    );
    if (!terminalOptions) {
      toast.error(i18next.t("workspace.addPanelMenu.startAgentFailed"));
      return;
    }
    const panelId = useWorkspaceStore.getState().addTerminal({
      ...terminalOptions,
      launchId,
    });
    if (!panelId) {
      toast.error(i18next.t("workspace.addPanelMenu.startAgentFailed"));
    }
  } catch (error) {
    await showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: i18next.t("workspace.addPanelMenu.startAgentFailed"),
    });
  }
}
function createAgentStartAction(
  entry: AgentCatalogEntry,
  visible: boolean,
  isDefault: boolean
): Action {
  return {
    category: "run",
    enabled: () => visible && useWorkspaceStore.getState().api !== null,
    handler: (invocation) => handleStartAgent(entry.id, invocation),
    id: agentStartId(entry.id),
    metadata: {
      aliases: () => getAgentCatalogAliases(entry),
      categoryKey: "run",
      group: "1_new",
      iconComponent: Bot,
      ...(isDefault ? { shortcutSourceId: "pier.agent.new" } : {}),
      sortOrder: startAgentSortOrder(entry.id),
      titleKey: "commandPalette.action.startAgent",
    },
    surfaces: visible ? ["command-palette", "create-menu"] : [],
    title: () =>
      i18next.t("commandPalette.action.startAgent", {
        agent: entry.label,
        defaultValue: `Start ${entry.label}`,
      }),
  };
}

/**
 * Subscribe to detect + preferences stores and keep the registry in sync.
 * Returns a disposer that unregisters all agent-start actions and unsubscribes.
 */
export function registerAgentStartActions(): () => void {
  const registrations = new Map<
    AgentKind,
    { dispose: () => void; isDefault: boolean; visible: boolean }
  >();

  function sync(): void {
    const { detectedIds } = useAgentDetectStore.getState();
    const { defaultAgentId, disabledAgentIds } =
      useAgentPreferencesStore.getState();
    const disabled = new Set(disabledAgentIds);
    const wanted = new Set(detectedIds.filter((id) => !disabled.has(id)));
    const selectedDefaultAgentId = pickAgent(
      defaultAgentId,
      detectedIds,
      disabledAgentIds
    );
    const retained = new Set(wanted);
    for (const binding of keybindingRegistry.getUserBindings()) {
      if (!binding.commandId.startsWith(AGENT_START_COMMAND_PREFIX)) {
        continue;
      }
      const id = binding.commandId.slice(AGENT_START_COMMAND_PREFIX.length);
      const entry = AGENT_CATALOG.find((candidate) => candidate.id === id);
      if (entry) {
        retained.add(entry.id);
      }
    }

    for (const [agentId, registration] of registrations) {
      if (!retained.has(agentId)) {
        registration.dispose();
        registrations.delete(agentId);
      }
    }

    for (const agentId of retained) {
      const visible = wanted.has(agentId);
      const isDefault = agentId === selectedDefaultAgentId;
      const current = registrations.get(agentId);
      if (current?.visible === visible && current.isDefault === isDefault) {
        continue;
      }
      current?.dispose();
      const entry = getAgentCatalogEntry(agentId);
      if (!entry) {
        registrations.delete(agentId);
        continue;
      }
      registrations.set(agentId, {
        dispose: registerDynamicAction(
          createAgentStartAction(entry, visible, isDefault)
        ),
        isDefault,
        visible,
      });
    }
  }

  const unsubDetect = useAgentDetectStore.subscribe(sync);
  const unsubPrefs = useAgentPreferencesStore.subscribe(sync);
  const unsubKeybindings = keybindingRegistry.subscribe(sync);
  sync();

  return () => {
    unsubDetect();
    unsubPrefs();
    unsubKeybindings();
    for (const registration of registrations.values()) {
      registration.dispose();
    }
    registrations.clear();
  };
}
