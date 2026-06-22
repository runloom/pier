import type { DockviewApi } from "dockview-react";
import { create } from "zustand";

interface WorkspaceState {
  addPanel: (opts: { id: string; title: string; component: string }) => void;
  addTab: () => void;
  api: DockviewApi | null;
  closeActivePanel: () => void;
  setApi: (api: DockviewApi | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  api: null,
  setApi: (api) => set({ api }),
  addPanel: (opts) => {
    const api = get().api;
    if (!api) {
      return;
    }
    api.addPanel({
      id: opts.id,
      component: opts.component,
      title: opts.title,
      position: { direction: "right" },
    });
  },
  addTab: () => {
    const api = get().api;
    if (!api) {
      return;
    }
    const id = `welcome-${Date.now()}`;
    const group = api.activeGroup;
    if (group) {
      // 有 active group → 在该 group 内加 tab (direction within)
      api.addPanel({
        id,
        component: "welcome",
        title: "Welcome",
        position: { referenceGroup: group, direction: "within" },
      });
    } else {
      // 无 active group → 新建 group
      api.addPanel({ id, component: "welcome", title: "Welcome" });
    }
  },
  closeActivePanel: () => {
    const api = get().api;
    if (!api) {
      return;
    }
    const panel = api.activePanel;
    if (panel) {
      api.removePanel(panel);
    }
  },
}));
