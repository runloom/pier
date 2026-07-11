import {
  getAgentCatalogAliases,
  getAgentCatalogEntry,
} from "@shared/agent-catalog.ts";
import { pickAgent } from "@shared/agent-selection.ts";
import i18next from "i18next";
import { isTaskRunPanelParams } from "@/lib/actions/task-run-operations.ts";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import type {
  ActionContributionRuntime,
  ActionWhenContext,
} from "./contribution-types.ts";
import type { ActionInvocation } from "./types.ts";

function actionTargetPanel(invocation?: ActionInvocation) {
  const api = useWorkspaceStore.getState().api;
  return invocation?.sourcePanelId
    ? api?.panels.find((panel) => panel.id === invocation.sourcePanelId)
    : api?.activePanel;
}

export function activeTerminalPanelId(): string | null {
  const panel = useWorkspaceStore.getState().api?.activePanel;
  return panel?.view.contentComponent === "terminal" ? panel.id : null;
}

/** 任务终端和后台任务输出面板都属于运行菜单的任务面板。 */
export function activeIsTaskRunPanel(invocation?: ActionInvocation): boolean {
  const panel = actionTargetPanel(invocation);
  return Boolean(
    panel?.view.contentComponent === "terminal" &&
      isTaskRunPanelParams(panel.params)
  );
}

export function rendererActionContext(
  invocation?: ActionInvocation
): ActionWhenContext {
  const api = useWorkspaceStore.getState().api;
  const targetPanel = actionTargetPanel(invocation);
  return {
    terminal: {
      activeIsTaskPanel: activeIsTaskRunPanel(invocation),
      hasActivePanel: targetPanel?.view.contentComponent === "terminal",
    },
    workspace: {
      activeGroupPanelCount: api?.activeGroup?.panels?.length ?? 0,
      groupCount: api?.groups?.length ?? 0,
      hasActivePanel: api?.activePanel != null,
      hasApi: api != null,
      panelCount: api?.panels?.length ?? 0,
    },
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function nestedValue(source: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (current, segment) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[segment]
          : undefined,
      source
    );
}

function registeredI18nLanguages(): string[] {
  return Object.keys(i18next.store.data);
}

function aliasesForLanguage(language: string, key: string): string[] {
  const bundle = i18next.getResourceBundle(language, "translation");
  const value = nestedValue(bundle, key);
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function resolveI18nAliases(key: string): readonly string[] {
  const languages = uniqueStrings([
    i18next.language,
    ...registeredI18nLanguages(),
  ]);
  return uniqueStrings(
    languages.flatMap((language) => aliasesForLanguage(language, key))
  );
}

export function resolveActionAliases(actionId: string): readonly string[] {
  const localizedAliases = resolveI18nAliases(
    `commandPalette.aliases.${actionId}`
  );
  if (actionId !== "pier.agent.new") {
    return localizedAliases;
  }

  const { detectedIds } = useAgentDetectStore.getState();
  const { defaultAgentId, disabledAgentIds } =
    useAgentPreferencesStore.getState();
  const agentId = pickAgent(defaultAgentId, detectedIds, disabledAgentIds);
  const entry = agentId ? getAgentCatalogEntry(agentId) : undefined;
  return entry
    ? uniqueStrings([...localizedAliases, ...getAgentCatalogAliases(entry)])
    : localizedAliases;
}

export const rendererActionContributionRuntime: ActionContributionRuntime = {
  getContext: rendererActionContext,
  resolveAliases: resolveActionAliases,
  t: (key, params) => (params ? i18next.t(key, params) : i18next.t(key)),
};
