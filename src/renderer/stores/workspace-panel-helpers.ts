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

/** Resolve a dockview group by its stable ID. */
export function findGroupById(
  api: DockviewApi | null,
  groupId: string | undefined
): WorkspaceGroupRef | undefined {
  if (!(groupId && api)) {
    return;
  }
  return api.groups.find((group) => group.id === groupId);
}

/**
 * Build a `{ referenceGroup }` opts object for the requested group ID.
 * Returns `{}` when the group can't be resolved, so callers can spread it into
 * addTerminal/addMissionControl opts without tripping exactOptionalPropertyTypes.
 */
export function referenceGroupById(
  api: DockviewApi | null,
  groupId: string | undefined
): { referenceGroup?: WorkspaceGroupRef } {
  const group = findGroupById(api, groupId);
  return group ? { referenceGroup: group } : {};
}

export interface WorkspaceSourceInvocation {
  sourcePanelContext?: PanelContext;
  sourcePanelGroupId?: string;
  sourcePanelId?: string;
}

export interface AnchoredTerminalTarget {
  context?: PanelContext;
  groupId?: string;
}

/** Capture terminal placement and context before an asynchronous launch starts. */
export function captureAnchoredTerminalTarget(
  api: DockviewApi | null,
  invocation?: WorkspaceSourceInvocation
): AnchoredTerminalTarget {
  const sourcePanelId = invocation?.sourcePanelId ?? api?.activePanel?.id;
  const context =
    useTerminalPreferencesStore.getState().terminalNewCwdPolicy ===
    "activeTerminal"
      ? (invocation?.sourcePanelContext ?? terminalPanelContext(sourcePanelId))
      : undefined;
  const groupId = invocation?.sourcePanelGroupId ?? api?.activeGroup?.id;
  return {
    ...(context ? { context } : {}),
    ...(groupId ? { groupId } : {}),
  };
}

/**
 * Resolve a previously captured target. A missing captured group is an error:
 * falling back to the current active group would launch in the wrong project.
 */
export function resolveAnchoredTerminalOptions(
  api: DockviewApi | null,
  target: AnchoredTerminalTarget
): { context?: PanelContext; referenceGroup?: WorkspaceGroupRef } | null {
  const referenceGroup = findGroupById(api, target.groupId);
  if (target.groupId && !referenceGroup) {
    return null;
  }
  return {
    ...(target.context ? { context: target.context } : {}),
    ...(referenceGroup ? { referenceGroup } : {}),
  };
}

export async function clearCurrentWindowLayout(): Promise<void> {
  const context = await window.pier.window.getContext();
  await window.pier.workspace.clearLayout(context.recordId);
}
