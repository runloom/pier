import type { PierCommandPlacement } from "@shared/contracts/commands.ts";
import type { PanelContext, PanelTabChrome } from "@shared/contracts/panel.ts";
import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import type { DockviewApi } from "dockview-react";
import { create } from "zustand";
import { equalizeDockviewSplits } from "@/components/workspace/dockview-equalize.ts";
import { closeCurrentWindow } from "@/lib/ipc/window-ipc.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import { runPanelCloseGuards } from "@/lib/workspace/panel-close-guards.ts";
import { scheduleRevealDockviewTabByPanelId } from "@/lib/workspace/tab-visibility.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";
import {
  clearFreshTerminalPanel,
  markFreshTerminalPanel,
  setFreshTerminalInitialInput,
} from "@/stores/terminal-panel-session-hints.store.ts";
import { useTerminalPreferencesStore } from "@/stores/terminal-preferences.store.ts";
import { focusWorkspaceGroup } from "@/stores/workspace-focus-group.ts";
import {
  clearCurrentWindowLayout,
  inheritedActiveTerminalContext,
  panelsInSameGroup,
  type TerminalPanelParams,
  terminalPanelContext,
  terminalPanelParams,
  uniquePanelId,
  type WorkspaceGroupRef,
} from "@/stores/workspace-panel-helpers.ts";
import { closeNativeTerminalPanel } from "@/stores/workspace-terminal-close.ts";

interface WorkspaceState {
  activateTabInActiveGroup: (index: number) => void;
  addPanel: (opts: {
    component: string;
    id: string;
    params?: TerminalPanelParams;
    title: string;
  }) => void;
  addTab: () => void;
  addTerminal: (opts?: {
    context?: PanelContext;
    initialInput?: string;
    launchId?: string;
    placement?: PierCommandPlacement;
    referenceGroup?: WorkspaceGroupRef;
    tab?: PanelTabChrome;
    task?: TaskPanelMetadata;
  }) => string | null;
  addWorkbench: (opts?: {
    referenceGroup?: WorkspaceGroupRef;
  }) => string | null;
  api: DockviewApi | null;
  closeActivePanel: () => Promise<boolean>;
  closeAll: () => Promise<void>;
  closeOthers: (panelId: string) => Promise<void>;
  closePanel: (panelId: string) => Promise<boolean>;
  equalizeSplits: () => void;
  focusGroup: (direction: "right" | "down" | "left" | "up") => void;
  hasMaximizedGroup: boolean;
  resetLayout: () => Promise<void>;
  setApi: (api: DockviewApi | null) => void;
  setHasMaximizedGroup: (hasMaximizedGroup: boolean) => void;
  splitPanel: (
    panelId: string,
    direction: "right" | "below" | "left" | "above"
  ) => void;
  syncTabShortcutHints: () => void;
  toggleActivePanelMaximized: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  api: null,
  hasMaximizedGroup: false,
  setApi: (api) => set({ api, hasMaximizedGroup: false }),
  setHasMaximizedGroup: (hasMaximizedGroup) => set({ hasMaximizedGroup }),
  syncTabShortcutHints: () => {
    useTerminalStore
      .getState()
      .setActiveGroupPanels(get().api?.activeGroup?.panels ?? []);
  },
  activateTabInActiveGroup: (index) => {
    const api = get().api;
    if (!(api && Number.isInteger(index) && index >= 0)) {
      return;
    }
    const targetPanel = api.activeGroup?.panels[index];
    if (!targetPanel) {
      return;
    }
    activateWorkspacePanel(api, targetPanel.id, {
      reveal: "always",
    });
  },
  addPanel: (opts) => {
    const api = get().api;
    if (!api) {
      return;
    }
    api.addPanel({
      id: opts.id,
      component: opts.component,
      title: opts.title,
      ...(opts.params && { params: opts.params }),
      position: { direction: "right" },
    });
    scheduleRevealDockviewTabByPanelId(opts.id);
  },
  addTab: () => {
    const api = get().api;
    if (!api) {
      return;
    }
    const id = uniquePanelId(api, "welcome");
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
    scheduleRevealDockviewTabByPanelId(id);
  },
  addTerminal(opts) {
    const api = get().api;
    if (!api) {
      return null;
    }
    const id = uniquePanelId(api, "terminal");
    const activeGroup = opts?.referenceGroup ?? api.activeGroup;
    const activePanel = api.activePanel;
    const splitDirection = (() => {
      switch (opts?.placement) {
        case "split-right":
          return "right";
        case "split-below":
          return "below";
        case "split-left":
          return "left";
        case "split-above":
          return "above";
        default:
          return null;
      }
    })();
    const position =
      splitDirection && activePanel
        ? { referencePanel: activePanel.id, direction: splitDirection }
        : undefined;
    const fallbackPosition = activeGroup
      ? { referenceGroup: activeGroup, direction: "within" as const }
      : { direction: "right" as const };
    const inheritedContext = opts?.context
      ? undefined
      : inheritedActiveTerminalContext(api);
    const context = opts?.context ?? inheritedContext;
    const params = terminalPanelParams({
      context,
      launchId: opts?.launchId,
      tab: opts?.tab,
      task: opts?.task,
    });
    const titlePath = context?.cwd;
    markFreshTerminalPanel(id);
    if (opts?.initialInput) {
      setFreshTerminalInitialInput(id, opts.initialInput);
    }
    try {
      api.addPanel({
        id,
        component: "terminal",
        title: titlePath ? `Terminal: ${titlePath}` : "Terminal",
        ...(params && { params }),
        position: position ?? fallbackPosition,
      });
    } catch (err) {
      clearFreshTerminalPanel(id);
      throw err;
    }
    scheduleRevealDockviewTabByPanelId(id);
    return id;
  },
  addWorkbench(opts) {
    const api = get().api;
    if (!api) {
      return null;
    }
    const id = uniquePanelId(api, "workbench");
    const activeGroup = opts?.referenceGroup ?? api.activeGroup;
    const fallbackPosition = activeGroup
      ? { referenceGroup: activeGroup, direction: "within" as const }
      : { direction: "right" as const };
    api.addPanel({
      id,
      component: "workbench",
      title: "Workbench",
      params: { widgets: [] },
      position: fallbackPosition,
    });
    scheduleRevealDockviewTabByPanelId(id);
    return id;
  },
  closeActivePanel: async () => {
    const api = get().api;
    if (!api) {
      return false;
    }
    const panel = api.activePanel;
    if (!panel) {
      return false;
    }
    const allowed = await runPanelCloseGuards({
      closingPanelIds: [panel.id],
      componentId: panel.view.contentComponent,
      panelId: panel.id,
      params: panel.params,
    });
    if (!allowed) {
      return false;
    }
    // 全局仅剩最后一个 panel → 关窗口 (而非删 panel 留空 group).
    if (api.totalPanels <= 1) {
      if (panel.view.contentComponent === "terminal") {
        closeNativeTerminalPanel(panel.id);
      }
      closeCurrentWindow().catch((err) => {
        console.error("[workspace] closeCurrentWindow failed:", err);
      });
      return true;
    }
    // 主动先发 native close IPC, 再 removePanel；不把 React unmount 当显式关闭.
    // 用 contentComponent 而非 params?.component: 前者是 dockview stable key.
    if (panel.view.contentComponent === "terminal") {
      closeNativeTerminalPanel(panel.id);
    }
    api.removePanel(panel);
    return true;
  },
  closePanel: async (panelId) => {
    const api = get().api;
    if (!api) {
      return false;
    }
    const panel = api.panels.find((p) => p.id === panelId);
    if (!panel) {
      return false;
    }
    const allowed = await runPanelCloseGuards({
      closingPanelIds: [panel.id],
      componentId: panel.view.contentComponent,
      panelId: panel.id,
      params: panel.params,
    });
    if (!allowed) {
      return false;
    }
    // 同 closeActivePanel: 全局仅剩最后一个 panel → 关窗口 (而非留空 group).
    if (api.totalPanels <= 1) {
      if (panel.view.contentComponent === "terminal") {
        closeNativeTerminalPanel(panel.id);
      }
      closeCurrentWindow().catch((err) => {
        console.error("[workspace] closeCurrentWindow failed:", err);
      });
      return true;
    }
    if (panel.view.contentComponent === "terminal") {
      closeNativeTerminalPanel(panel.id);
    }
    api.removePanel(panel);
    return true;
  },

  closeOthers: async (panelId) => {
    const api = get().api;
    if (!api) {
      return;
    }
    const keepPanel = api.panels.find((p) => p.id === panelId);
    if (!keepPanel) {
      return;
    }
    const toClose = panelsInSameGroup(api, keepPanel.id).filter(
      (p) => p.id !== panelId
    );
    const closingPanelIds = toClose.map((p) => p.id);
    for (const p of toClose) {
      const allowed = await runPanelCloseGuards({
        closingPanelIds,
        componentId: p.view.contentComponent,
        panelId: p.id,
        params: p.params,
      });
      if (!allowed) {
        continue;
      }
      if (p.view.contentComponent === "terminal") {
        closeNativeTerminalPanel(p.id);
      }
      api.removePanel(p);
    }
  },

  closeAll: async () => {
    const api = get().api;
    if (!api) {
      return;
    }
    const all = [...api.panels];
    const closingPanelIds = all.map((p) => p.id);
    for (const p of all) {
      const allowed = await runPanelCloseGuards({
        closingPanelIds,
        componentId: p.view.contentComponent,
        panelId: p.id,
        params: p.params,
      });
      if (!allowed) {
        return;
      }
      if (p.view.contentComponent === "terminal") {
        closeNativeTerminalPanel(p.id);
      }
      api.removePanel(p);
    }
    // 所有 panel 都已通过各自 guard 并提交关闭后,显式清掉 record layout。
    // 这既避免用户取消时提前破坏持久化布局,也避免全关窗口把空 dockview
    // JSON 当作可恢复布局写回。
    try {
      await clearCurrentWindowLayout();
    } catch (err) {
      console.error("[workspace] clearLayout failed:", err);
    }
    // 同 closePanel/closeActivePanel: 全 panel 关闭等价于"想退出当前 workspace",
    // 留空 dockview 用户无路可走 (Cmd+T 才能恢复). 一律 close window 保持对称.
    closeCurrentWindow().catch((err) => {
      console.error("[workspace] closeCurrentWindow failed:", err);
    });
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
    const newId = uniquePanelId(api, component);
    const params =
      component === "terminal" &&
      useTerminalPreferencesStore.getState().terminalNewCwdPolicy ===
        "activeTerminal"
        ? (() => {
            const context = terminalPanelContext(panel.id);
            return context ? { context } : undefined;
          })()
        : undefined;
    if (component === "terminal") {
      markFreshTerminalPanel(newId);
    }
    try {
      api.addPanel({
        id: newId,
        component,
        ...(panel.title !== undefined && { title: panel.title }),
        ...(params && { params }),
        position: {
          referencePanel: panel.id,
          direction,
        },
      });
    } catch (err) {
      if (component === "terminal") {
        clearFreshTerminalPanel(newId);
      }
      throw err;
    }
    scheduleRevealDockviewTabByPanelId(newId);
  },

  equalizeSplits: () => {
    const api = get().api;
    if (!api) {
      return;
    }
    try {
      equalizeDockviewSplits(api);
    } catch (err) {
      console.error("[workspace] equalizeSplits failed:", err);
    }
  },

  focusGroup: (direction) => {
    const api = get().api;
    if (api) {
      focusWorkspaceGroup(api, direction);
    }
  },

  toggleActivePanelMaximized: () => {
    const panel = get().api?.activePanel;
    if (!panel) {
      return;
    }
    if (panel.api.isMaximized()) {
      panel.api.exitMaximized();
      return;
    }
    panel.api.maximize();
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
      await clearCurrentWindowLayout();
    } catch (err) {
      console.error("[workspace] clearLayout failed:", err);
    }
    // 显式 close terminal panel (同 closeActivePanel 注释 — 主动先发 IPC).
    const panels = [...api.panels];
    for (const p of panels) {
      if (p.view.contentComponent === "terminal") {
        closeNativeTerminalPanel(p.id);
      }
      api.removePanel(p);
    }
    // 重建 default — 与 workspace-host.applyDefaultLayout 一致.
    markFreshTerminalPanel("terminal-1");
    try {
      api.addPanel({
        id: "terminal-1",
        component: "terminal",
        title: "Terminal",
      });
    } catch (err) {
      clearFreshTerminalPanel("terminal-1");
      throw err;
    }
    scheduleRevealDockviewTabByPanelId("terminal-1");
  },
}));
