import type { DockviewApi } from "dockview-react";
import { create } from "zustand";
import { closeCurrentWindow } from "@/lib/ipc/window-ipc.ts";

interface WorkspaceState {
  addPanel: (opts: { id: string; title: string; component: string }) => void;
  addTab: () => void;
  addTerminal: () => void;
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
  addTerminal() {
    const api = get().api;
    if (!api) {
      return;
    }
    const id = `terminal-${Date.now()}`;
    const activeGroup = api.activeGroup;
    api.addPanel({
      id,
      component: "terminal",
      title: "Terminal",
      position: activeGroup
        ? { referenceGroup: activeGroup, direction: "within" }
        : { direction: "right" },
    });
  },
  closeActivePanel: () => {
    const api = get().api;
    if (!api) {
      return;
    }
    const panel = api.activePanel;
    if (!panel) {
      return;
    }
    // 全局仅剩最后一个 panel → 关窗口 (而非删 panel 留空 group).
    if (api.totalPanels <= 1) {
      closeCurrentWindow().catch((err) => {
        console.error("[workspace] closeCurrentWindow failed:", err);
      });
      return;
    }
    // 主动先发 native terminal close IPC, 再 removePanel — 不依赖 React unmount
    // 时序. dockview removePanel 会同步 dispose React tree, useEffect cleanup 也会
    // 调 terminal.close (idempotent, swift close 二次调用 no-op), 这里只是确保
    // close IPC 一定先于 dockview 内部 panel state 销毁 fire.
    //
    // 用 panel.view.contentComponent 而非 panel.params?.component:
    // contentComponent 是 dockview 注册组件的 stable readonly string (panel-registry
    // 的 key), params 是用户传入的自由数据, 不保证有 component 字段.
    if (panel.view.contentComponent === "terminal") {
      window.pier?.terminal?.close?.(panel.id);
    }
    api.removePanel(panel);
  },
}));
