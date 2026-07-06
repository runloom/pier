import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import i18next from "i18next";
import { taskPanelMetadataFromParams } from "@/lib/workspace/task-panel-metadata.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import type {
  ActionContributionRuntime,
  ActionWhenContext,
} from "./contribution-types.ts";

interface ActiveTaskPanelRef {
  panelId: string;
  task: TaskPanelMetadata;
}

export function activeTerminalPanelId(): string | null {
  const panel = useWorkspaceStore.getState().api?.activePanel;
  return panel?.view.contentComponent === "terminal" ? panel.id : null;
}

/** active panel 是任务面板时返回其任务元数据, 否则 null。 */
export function activeTaskPanelMetadata(): TaskPanelMetadata | null {
  const panel = useWorkspaceStore.getState().api?.activePanel;
  if (panel?.view.contentComponent !== "terminal") {
    return null;
  }
  return taskPanelMetadataFromParams(panel.params) ?? null;
}

export function activeTaskPanelRef(): ActiveTaskPanelRef | null {
  const panel = useWorkspaceStore.getState().api?.activePanel;
  if (panel?.view.contentComponent !== "terminal") {
    return null;
  }
  const task = taskPanelMetadataFromParams(panel.params);
  return task ? { panelId: panel.id, task } : null;
}

export function rendererActionContext(): ActionWhenContext {
  const api = useWorkspaceStore.getState().api;
  return {
    terminal: {
      activeIsTaskPanel: activeTaskPanelMetadata() != null,
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
  return resolveI18nAliases(`commandPalette.aliases.${actionId}`);
}

export const rendererActionContributionRuntime: ActionContributionRuntime = {
  getContext: rendererActionContext,
  resolveAliases: resolveActionAliases,
  t: (key, params) => (params ? i18next.t(key, params) : i18next.t(key)),
};
