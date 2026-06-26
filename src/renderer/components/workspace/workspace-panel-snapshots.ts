import type { PanelSnapshot } from "@shared/contracts/events.ts";
import type { PanelDescriptor } from "@/stores/panel-descriptor.store.ts";
import { panelKindOf } from "./panel-registry.ts";

interface WorkspacePanelLike {
  id: string;
  title?: string | undefined;
  view: { contentComponent: string };
}

interface WorkspaceGroupLike {
  panels: readonly WorkspacePanelLike[];
}

interface WorkspaceSnapshotApiLike {
  activePanel?: WorkspacePanelLike | null | undefined;
  groups?: readonly WorkspaceGroupLike[];
  panels: readonly WorkspacePanelLike[];
}

export interface WorkspacePanelSnapshot extends PanelSnapshot {
  groupIndex: number;
  tabCount: number;
  tabIndex: number;
}

function positionForPanel(
  api: WorkspaceSnapshotApiLike,
  panelId: string
): Pick<WorkspacePanelSnapshot, "groupIndex" | "tabCount" | "tabIndex"> {
  for (const [groupIndex, group] of (api.groups ?? []).entries()) {
    const tabIndex = group.panels.findIndex((panel) => panel.id === panelId);
    if (tabIndex >= 0) {
      return {
        groupIndex,
        tabCount: group.panels.length,
        tabIndex,
      };
    }
  }

  const tabIndex = Math.max(
    0,
    api.panels.findIndex((panel) => panel.id === panelId)
  );
  return {
    groupIndex: 0,
    tabCount: api.panels.length,
    tabIndex,
  };
}

export function buildWorkspacePanelSnapshots(
  api: WorkspaceSnapshotApiLike,
  descriptors: Readonly<Record<string, PanelDescriptor>>
): WorkspacePanelSnapshot[] {
  return api.panels.map((panel) => {
    const component = panel.view.contentComponent;
    const descriptor = descriptors[panel.id];
    const position = positionForPanel(api, panel.id);
    const title = descriptor?.short ?? panel.title;
    const terminalTitle =
      descriptor?.long &&
      descriptor.long !== descriptor.path &&
      descriptor.long !== title
        ? descriptor.long
        : undefined;
    return {
      active: panel.id === api.activePanel?.id,
      id: panel.id,
      kind: panelKindOf(component),
      ...position,
      ...(title ? { title } : {}),
      ...(terminalTitle ? { terminalTitle } : {}),
      ...(descriptor?.path ? { cwd: descriptor.path } : {}),
    };
  });
}
