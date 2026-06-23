import type { DockviewApi } from "dockview-react";
import { create } from "zustand";
import { closeCurrentWindow } from "@/lib/ipc/window-ipc.ts";

interface WorkspaceState {
  addPanel: (opts: { id: string; title: string; component: string }) => void;
  addTab: () => void;
  addTerminal: () => void;
  api: DockviewApi | null;
  closeActivePanel: () => void;
  closeAll: () => void;
  closeOthers: (panelId: string) => void;
  closePanel: (panelId: string) => void;
  resetLayout: () => Promise<void>;
  setApi: (api: DockviewApi | null) => void;
  splitPanel: (panelId: string, direction: "right" | "below") => void;
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
  closePanel: (panelId) => {
    const api = get().api;
    if (!api) {
      return;
    }
    const panel = api.panels.find((p) => p.id === panelId);
    if (!panel) {
      return;
    }
    // 同 closeActivePanel: 全局仅剩最后一个 panel → 关窗口 (而非留空 group).
    if (api.totalPanels <= 1) {
      closeCurrentWindow().catch((err) => {
        console.error("[workspace] closeCurrentWindow failed:", err);
      });
      return;
    }
    if (panel.view.contentComponent === "terminal") {
      window.pier?.terminal?.close?.(panel.id);
    }
    api.removePanel(panel);
  },

  closeOthers: (panelId) => {
    const api = get().api;
    if (!api) {
      return;
    }
    const keepPanel = api.panels.find((p) => p.id === panelId);
    if (!keepPanel) {
      return;
    }
    const toClose = api.panels.filter((p) => p.id !== panelId);
    for (const p of toClose) {
      if (p.view.contentComponent === "terminal") {
        window.pier?.terminal?.close?.(p.id);
      }
      api.removePanel(p);
    }
  },

  closeAll: () => {
    const api = get().api;
    if (!api) {
      return;
    }
    const all = [...api.panels];
    for (const p of all) {
      if (p.view.contentComponent === "terminal") {
        window.pier?.terminal?.close?.(p.id);
      }
      api.removePanel(p);
    }
  },

  splitPanel: (panelId, direction) => {
    const api = get().api;
    if (!api) {
      return;
    }
    const panel = api.panels.find((p) => p.id === panelId);
    if (!panel) {
      return;
    }
    const component = panel.view.contentComponent;
    const prefix = component === "terminal" ? "terminal" : component;
    const newId = `${prefix}-${Date.now()}`;
    api.addPanel({
      id: newId,
      component,
      ...(panel.title !== undefined && { title: panel.title }),
      position: {
        referencePanel: panel.id,
        direction,
      },
    });
  },

  resetLayout: async () => {
    const api = get().api;
    if (!api) {
      return;
    }
    // 先清 disk layout — 防 removePanel/addPanel 触发的 debounced save 与 user 重启
    // 的时序竞争. clearLayout 后再 addPanel 触发的 save 写回的是 default layout,
    // 即使覆盖也无害.
    try {
      await window.pier?.workspace?.clearLayout?.();
    } catch (err) {
      console.error("[workspace] clearLayout failed:", err);
    }
    // 显式 close terminal panel (同 closeActivePanel 注释 — 主动先发 IPC).
    const panels = [...api.panels];
    for (const p of panels) {
      if (p.view.contentComponent === "terminal") {
        window.pier?.terminal?.close?.(p.id);
      }
      api.removePanel(p);
    }
    // 重建 default — 与 workspace-host.applyDefaultLayout 一致.
    api.addPanel({
      id: "terminal-1",
      component: "terminal",
      title: "Terminal",
    });
  },
}));
