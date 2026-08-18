import type { PierCommandPlacement } from "@shared/contracts/commands.ts";
import type { PanelContext, PanelTabChrome } from "@shared/contracts/panel.ts";
import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import type { DockviewApi } from "dockview-react";
import { create } from "zustand";
import { isWorkspaceBootstrapGateActive } from "@/components/workspace/bootstrap-gate.ts";
import { equalizeDockviewSplits } from "@/components/workspace/dockview-equalize.ts";
import { showInactiveSplitPanel } from "@/components/workspace/dockview-inactive-split.ts";
import {
  equalizeDockviewPanelGroup,
  type PanelSizeMutationResult,
  setDockviewPanelSize,
} from "@/components/workspace/dockview-panel-size.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import { prepareTabStripScrollsForMaximizeLayoutMutation } from "@/lib/workspace/tab-strip-scroll.ts";
import { scheduleRevealDockviewTabByPanelId } from "@/lib/workspace/tab-visibility.ts";
import {
  clearFreshTerminalPanel,
  markFreshTerminalPanel,
  setFreshTerminalInitialInput,
} from "@/stores/terminal-panel-session-hints.store.ts";
import { useTerminalPreferencesStore } from "@/stores/terminal-preferences.store.ts";
import {
  closeActivePanel as closeActivePanelImpl,
  closeAll as closeAllImpl,
  closeGroup as closeGroupImpl,
  closeOthers as closeOthersImpl,
  closePanel as closePanelImpl,
  closeToTheRight as closeToTheRightImpl,
} from "@/stores/workspace-close.ts";
import { focusWorkspaceGroup } from "@/stores/workspace-focus-group.ts";
import {
  clearCurrentWindowLayout,
  inheritedActiveTerminalContext,
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
    /** `null` forces no cwd; omit the key to inherit from the active terminal. */
    context?: PanelContext | null;
    exitPresentation?: TerminalPanelParams["exitPresentation"];
    /** 省略/`true` 保持今天 reveal+激活；`false` 走 dockview `inactive` 且不 reveal。 */
    focus?: boolean;
    initialInput?: string;
    initialInputSubmit?: boolean;
    launchId?: string;
    placement?: PierCommandPlacement;
    referenceGroup?: WorkspaceGroupRef;
    /** 相对分屏锚点；缺省为 `api.activePanel`。指向不存在的 panel 时抛错，不回落 active。 */
    referencePanelId?: string;
    tab?: PanelTabChrome;
    task?: TaskPanelMetadata;
  }) => string | null;
  addWorkbench: (opts?: {
    referenceGroup?: WorkspaceGroupRef;
  }) => string | null;
  api: DockviewApi | null;
  closeActivePanel: () => Promise<boolean>;
  closeAll: () => Promise<void>;
  /**
   * 关闭同组全部标签（含当前）。
   * 多分组时只卸本组；sole-group 卸完后关窗（与 closeAll 对称，避免空 dockview）。
   */
  closeGroup: (panelId: string) => Promise<void>;
  closeOthers: (panelId: string) => Promise<void>;
  closePanel: (panelId: string) => Promise<boolean>;
  /** 关闭同组中位于 source 右侧的 tabs（按 group.panels 顺序）。 */
  closeToTheRight: (panelId: string) => Promise<void>;
  equalizePanelGroup: (input: {
    axis: "horizontal" | "vertical";
    panelIds: readonly string[];
  }) => PanelSizeMutationResult;
  equalizeSplits: () => void;
  focusGroup: (
    direction: "right" | "down" | "left" | "up",
    sourcePanelId?: string
  ) => void;
  hasMaximizedGroup: boolean;
  resetLayout: () => Promise<void>;
  setApi: (api: DockviewApi | null) => void;
  setHasMaximizedGroup: (hasMaximizedGroup: boolean) => void;
  setPanelSize: (input: {
    heightRatio?: number;
    panelId: string;
    widthRatio?: number;
  }) => PanelSizeMutationResult;
  splitPanel: (
    panelId: string,
    direction: "right" | "below" | "left" | "above"
  ) => void;
  toggleActivePanelMaximized: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  api: null,
  hasMaximizedGroup: false,
  setApi: (api) => set({ api, hasMaximizedGroup: false }),
  setHasMaximizedGroup: (hasMaximizedGroup) => set({ hasMaximizedGroup }),
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
    if (isWorkspaceBootstrapGateActive()) {
      return;
    }
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
    if (isWorkspaceBootstrapGateActive()) {
      return null;
    }
    const api = get().api;
    if (!api) {
      return null;
    }
    const id = uniquePanelId(api, "terminal");
    const activeGroup = opts?.referenceGroup ?? api.activeGroup;
    const activePanel = api.activePanel;
    if (opts?.referencePanelId) {
      const exists = api.panels.some(
        (panel) => panel.id === opts.referencePanelId
      );
      if (!exists) {
        throw new Error(`reference panel not found: ${opts.referencePanelId}`);
      }
    }
    const referencePanel = opts?.referencePanelId
      ? api.panels.find((panel) => panel.id === opts.referencePanelId)
      : activePanel;
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
    const position = (() => {
      if (splitDirection && referencePanel) {
        return { referencePanel: referencePanel.id, direction: splitDirection };
      }
      if (opts?.referencePanelId && referencePanel) {
        return {
          referencePanel: referencePanel.id,
          direction: "within" as const,
        };
      }
      if (activeGroup) {
        return { referenceGroup: activeGroup, direction: "within" as const };
      }
      return { direction: "right" as const };
    })();
    const context =
      opts && Object.hasOwn(opts, "context")
        ? (opts.context ?? undefined)
        : inheritedActiveTerminalContext(api);
    const params = terminalPanelParams({
      context,
      exitPresentation: opts?.exitPresentation,
      launchId: opts?.launchId,
      tab: opts?.tab,
      task: opts?.task,
    });
    const titlePath = context?.cwd;
    markFreshTerminalPanel(id);
    if (opts?.initialInput) {
      setFreshTerminalInitialInput(id, {
        submit: opts.initialInputSubmit !== false,
        text: opts.initialInput,
      });
    }
    const inactive = opts?.focus === false;
    try {
      api.addPanel({
        id,
        component: "terminal",
        title: titlePath ? `Terminal: ${titlePath}` : "Terminal",
        ...(params && { params }),
        ...(inactive ? { inactive: true } : {}),
        position,
      });
    } catch (err) {
      clearFreshTerminalPanel(id);
      throw err;
    }
    if (inactive) {
      showInactiveSplitPanel(api, id);
    } else {
      scheduleRevealDockviewTabByPanelId(id);
    }
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
    // 工作台是全局 panel：不持有项目路径。其上的路径依赖操作（新建终端/任务等）
    // 因无 context 而禁用，不会回落到同组终端 cwd。
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
  closeActivePanel: async () => closeActivePanelImpl(get),
  closePanel: async (panelId) => closePanelImpl(get, panelId),
  closeOthers: async (panelId) => closeOthersImpl(get, panelId),
  closeToTheRight: async (panelId) => closeToTheRightImpl(get, panelId),
  closeGroup: async (panelId) => closeGroupImpl(get, panelId),
  closeAll: async () => closeAllImpl(get),

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

  equalizePanelGroup: (input) => {
    const api = get().api;
    if (!api) {
      return {
        code: "platform_unavailable",
        message: "workspace api not ready",
        ok: false,
      };
    }
    return equalizeDockviewPanelGroup(api, input);
  },

  setPanelSize: (input) => {
    const api = get().api;
    if (!api) {
      return {
        code: "platform_unavailable",
        message: "workspace api not ready",
        ok: false,
      };
    }
    return setDockviewPanelSize(api, input);
  },

  focusGroup: (direction, sourcePanelId) => {
    const api = get().api;
    if (api) {
      focusWorkspaceGroup(api, direction, sourcePanelId);
    }
  },

  toggleActivePanelMaximized: () => {
    const panel = get().api?.activePanel;
    if (!panel) {
      return;
    }
    // P1: snapshot tab strips while still laid out, before dockview hide.
    prepareTabStripScrollsForMaximizeLayoutMutation();
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
