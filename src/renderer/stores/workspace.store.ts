import type { DockviewApi } from "dockview-react";
import { create } from "zustand";

interface WorkspaceState {
  addPanel: (opts: { id: string; title: string; component: string }) => void;
  api: DockviewApi | null;
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
}));
