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

function contextFromGroupTerminal(
  api: DockviewApi,
  groupId: string | undefined
): PanelContext | undefined {
  if (!groupId) {
    return;
  }
  const group = findGroupById(api, groupId);
  if (!group) {
    return;
  }
  // Prefer the group's last-active terminal when the current tab is not one
  // (e.g. workbench). Tab order in panels[] is not a stable project signal.
  const groupActive = group.activePanel;
  if (groupActive?.view.contentComponent === "terminal") {
    const activeContext = terminalPanelContext(groupActive.id);
    if (activeContext) {
      return activeContext;
    }
  }
  let newest: PanelContext | undefined;
  for (const panel of group.panels) {
    if (panel.view.contentComponent !== "terminal") {
      continue;
    }
    const context = terminalPanelContext(panel.id);
    if (!context) {
      continue;
    }
    if (!newest || context.updatedAt > newest.updatedAt) {
      newest = context;
    }
  }
  return newest;
}

function panelComponent(
  api: DockviewApi,
  panelId: string | undefined
): string | undefined {
  if (!panelId) {
    return;
  }
  return api.panels.find((panel) => panel.id === panelId)?.view
    .contentComponent;
}

function panelInGroup(
  api: DockviewApi,
  panelId: string,
  groupId: string | undefined
): boolean {
  if (!groupId) {
    return false;
  }
  const group = findGroupById(api, groupId);
  return group?.panels.some((panel) => panel.id === panelId) ?? false;
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
  if (activePanel?.view.contentComponent === "terminal") {
    return terminalPanelContext(activePanel.id);
  }
  return contextFromGroupTerminal(api, api.activeGroup?.id);
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
 * addTerminal/addWorkbench opts without tripping exactOptionalPropertyTypes.
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

export interface WorkspaceAnchor {
  context?: PanelContext;
  groupId?: string;
}

/**
 * Resolve the workspace directory/project anchor for create/open actions.
 *
 * Order:
 * 1. explicit source panel context
 * 2. source panel descriptor context (or active panel only when it belongs to
 *    the resolved group)
 * 3. same-group terminal context when the source is not itself a terminal
 *
 * Terminal sources never inherit a sibling terminal's cwd. `shellDefault`
 * suppresses context inheritance entirely.
 */
export function resolveWorkspaceAnchor(input: {
  api: DockviewApi | null;
  sourcePanelContext?: PanelContext | undefined;
  sourcePanelGroupId?: string | undefined;
  sourcePanelId?: string | undefined;
}): WorkspaceAnchor {
  const groupId =
    input.sourcePanelGroupId ?? input.api?.activeGroup?.id ?? undefined;
  if (
    useTerminalPreferencesStore.getState().terminalNewCwdPolicy !==
    "activeTerminal"
  ) {
    return {
      ...(groupId ? { groupId } : {}),
    };
  }
  if (input.sourcePanelContext) {
    return {
      context: input.sourcePanelContext,
      ...(groupId ? { groupId } : {}),
    };
  }

  let sourcePanelId = input.sourcePanelId;
  if (!sourcePanelId && input.api?.activePanel) {
    const activeId = input.api.activePanel.id;
    // When the caller pinned a group, never pull context from a foreign
    // active panel that lives outside that group.
    if (
      !input.sourcePanelGroupId ||
      panelInGroup(input.api, activeId, input.sourcePanelGroupId)
    ) {
      sourcePanelId = activeId;
    }
  }

  const sourceComponent = input.api
    ? panelComponent(input.api, sourcePanelId)
    : undefined;
  const directContext = terminalPanelContext(sourcePanelId);
  if (directContext) {
    return {
      context: directContext,
      ...(groupId ? { groupId } : {}),
    };
  }
  // Fresh/empty terminal stays empty — do not steal a sibling project.
  if (sourceComponent === "terminal") {
    return {
      ...(groupId ? { groupId } : {}),
    };
  }

  const groupContext =
    input.api === null
      ? undefined
      : contextFromGroupTerminal(input.api, groupId);
  return {
    ...(groupContext ? { context: groupContext } : {}),
    ...(groupId ? { groupId } : {}),
  };
}

export interface AnchoredTerminalTarget {
  /**
   * `null` = intentionally no project cwd (empty terminal / shellDefault).
   * Must stay sticky across async prepareLaunch — do not re-inherit later.
   */
  readonly context?: PanelContext | null;
  readonly groupId?: string;
}

/** Capture terminal placement and context before an asynchronous launch starts. */
export function captureAnchoredTerminalTarget(
  api: DockviewApi | null,
  invocation?: WorkspaceSourceInvocation
): AnchoredTerminalTarget {
  const anchor = resolveWorkspaceAnchor({
    api,
    sourcePanelContext: invocation?.sourcePanelContext,
    sourcePanelGroupId: invocation?.sourcePanelGroupId,
    sourcePanelId: invocation?.sourcePanelId,
  });
  return {
    // Always pin: missing context is an intentional empty cwd, not "inherit later".
    context: anchor.context ?? null,
    ...(anchor.groupId ? { groupId: anchor.groupId } : {}),
  };
}

/**
 * Resolve a previously captured target. A missing captured group is an error:
 * falling back to the current active group would launch in the wrong project.
 */
export function resolveAnchoredTerminalOptions(
  api: DockviewApi | null,
  target: AnchoredTerminalTarget
): {
  context?: PanelContext | null;
  referenceGroup?: WorkspaceGroupRef;
} | null {
  const referenceGroup = findGroupById(api, target.groupId);
  if (target.groupId && !referenceGroup) {
    return null;
  }
  return {
    // Forward pinned null/value so addTerminal does not re-inherit after await.
    context: target.context ?? null,
    ...(referenceGroup ? { referenceGroup } : {}),
  };
}

export async function clearCurrentWindowLayout(): Promise<void> {
  const context = await window.pier.window.getContext();
  await window.pier.workspace.clearLayout(context.recordId);
}
