import type { PanelContext, PanelTabChrome } from "@shared/contracts/panel.ts";
import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import type { DockviewApi } from "dockview-react";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useTerminalPreferencesStore } from "@/stores/terminal-preferences.store.ts";

export interface TerminalPanelParams {
  context?: PanelContext;
  launchId?: string;
  tab?: PanelTabChrome;
  task?: TaskPanelMetadata;
}

export type WorkspaceGroupRef = NonNullable<DockviewApi["activeGroup"]>;
type WorkspacePanelRef = DockviewApi["panels"][number];

export function terminalPanelContext(
  panelId: string | undefined
): PanelContext | undefined {
  if (!panelId) {
    return;
  }
  return usePanelDescriptorStore.getState().descriptors[panelId]?.context;
}

export function terminalPanelParams(args: {
  context: PanelContext | undefined;
  launchId: string | undefined;
  tab: PanelTabChrome | undefined;
  task: TaskPanelMetadata | undefined;
}): TerminalPanelParams | undefined {
  if (!(args.context || args.launchId || args.tab || args.task)) {
    return;
  }
  return {
    ...(args.context && { context: args.context }),
    ...(args.launchId && { launchId: args.launchId }),
    ...(args.tab && { tab: args.tab }),
    ...(args.task && { task: args.task }),
  };
}

export function inheritedActiveTerminalContext(
  api: DockviewApi
): PanelContext | undefined {
  if (
    useTerminalPreferencesStore.getState().terminalNewCwdPolicy !==
    "activeTerminal"
  ) {
    return;
  }
  const activePanel = api.activePanel;
  if (activePanel?.view.contentComponent !== "terminal") {
    return;
  }
  return terminalPanelContext(activePanel.id);
}

export function uniquePanelId(api: DockviewApi, prefix: string): string {
  const base = `${prefix}-${Date.now()}`;
  const existing = new Set(api.panels.map((panel) => panel.id));
  if (!existing.has(base)) {
    return base;
  }
  let suffix = 1;
  while (existing.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export function panelsInSameGroup(
  api: DockviewApi,
  panelId: string
): readonly WorkspacePanelRef[] {
  const group = api.groups.find((candidate) =>
    candidate.panels.some((panel) => panel.id === panelId)
  );
  if (group) {
    return group.panels;
  }
  const activeGroupPanels = api.activeGroup?.panels;
  if (activeGroupPanels?.some((panel) => panel.id === panelId)) {
    return activeGroupPanels;
  }
  return api.panels;
}

export async function clearCurrentWindowLayout(): Promise<void> {
  const context = await window.pier.window.getContext();
  await window.pier.workspace.clearLayout(context.recordId);
}
