import { create } from "zustand";

export type PanelResourceMode =
  | "coldSuspendedCandidate"
  | "visible"
  | "warmHidden";

export interface PanelResourcePanelInput {
  dockviewActive: boolean;
  dockviewVisible: boolean;
  id: string;
}

export interface PanelResourceSnapshotInput {
  activePanelId: string | null;
  panels: PanelResourcePanelInput[];
}

interface PanelResourceEntry {
  dockviewActive: boolean;
  dockviewVisible: boolean;
  mode: PanelResourceMode;
}

interface PanelResourceState {
  panels: Record<string, PanelResourceEntry>;
  replaceSnapshot: (snapshot: PanelResourceSnapshotInput) => void;
}

export function derivePanelResourceMode(args: {
  dockviewActive: boolean;
  dockviewVisible: boolean;
  isActivePanel: boolean;
}): PanelResourceMode {
  return args.dockviewVisible || args.dockviewActive || args.isActivePanel
    ? "visible"
    : "warmHidden";
}

export const usePanelResourceStore = create<PanelResourceState>((set) => ({
  panels: {},
  replaceSnapshot: (snapshot) => {
    set({
      panels: Object.fromEntries(
        snapshot.panels.map((panel) => [
          panel.id,
          {
            dockviewActive: panel.dockviewActive,
            dockviewVisible: panel.dockviewVisible,
            mode: derivePanelResourceMode({
              dockviewActive: panel.dockviewActive,
              dockviewVisible: panel.dockviewVisible,
              isActivePanel: snapshot.activePanelId === panel.id,
            }),
          },
        ])
      ),
    });
  },
}));

export function updatePanelResourceSnapshot(
  snapshot: PanelResourceSnapshotInput
): void {
  usePanelResourceStore.getState().replaceSnapshot(snapshot);
}

export function usePanelResourceMode(panelId: string): PanelResourceMode {
  return (
    usePanelResourceStore((state) => state.panels[panelId]?.mode) ?? "visible"
  );
}
