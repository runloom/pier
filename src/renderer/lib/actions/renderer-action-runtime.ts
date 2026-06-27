import i18next from "i18next";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import type {
  ActionContributionRuntime,
  ActionWhenContext,
} from "./contribution-types.ts";

export function activeTerminalPanelId(): string | null {
  const panel = useWorkspaceStore.getState().api?.activePanel;
  return panel?.view.contentComponent === "terminal" ? panel.id : null;
}

export function rendererActionContext(): ActionWhenContext {
  const api = useWorkspaceStore.getState().api;
  return {
    terminal: {
      hasActivePanel: activeTerminalPanelId() != null,
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

export function resolveI18nAliases(key: string): readonly string[] {
  const value = i18next.t(key, { returnObjects: true });
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export const rendererActionContributionRuntime: ActionContributionRuntime = {
  getContext: rendererActionContext,
  resolveAliases: resolveI18nAliases,
  t: (key) => i18next.t(key),
};
