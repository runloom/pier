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
import { PANEL_TAB_FILE_COMPONENT_ID } from "@/components/workspace/panel-tab-layout.ts";
import { attachWorkspaceGroupMru } from "@/lib/workspace/group-mru.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import {
  withinGroupPosition,
  withinPanelPosition,
} from "@/lib/workspace/panel-insert.ts";
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
    /** 后台创建：跳过可见性门控，挂载即建面（agents.start 委派路径）。 */
    backgroundCreate?: boolean;
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
  /** Cycle tabs in the active group; wraps. Positive = next. */
  cycleActiveGroupTab: (delta: number) => void;
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

let detachWorkspaceGroupMru = (): void => undefined;

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  api: null,
  hasMaximizedGroup: false,
  setApi: (api) => {
    detachWorkspaceGroupMru();
    detachWorkspaceGroupMru = api
      ? attachWorkspaceGroupMru(api)
      : () => undefined;
    set({ api, hasMaximizedGroup: false });
  },
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
  cycleActiveGroupTab: (delta) => {
    const api = get().api;
    const panels = api?.activeGroup?.panels;
    if (!(api && panels && panels.length > 0 && Number.isInteger(delta))) {
      return;
    }
    const currentId = api.activePanel?.id;
    const currentIndex = panels.findIndex((panel) => panel.id === currentId);
    const from = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = (from + delta + panels.length) % panels.length;
    const targetPanel = panels[nextIndex];
    if (!targetPanel || targetPanel.id === currentId) {
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
      // 空白 Welcome 贴条尾（+ 在 header 右）；相关打开走 after-active。
      api.addPanel({
        id,
        component: "welcome",
        title: "Welcome",
        position: withinGroupPosition(group, "end"),
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
        const referenceGroup =
          api.groups?.find((group) =>
            group.panels.some((panel) => panel.id === referencePanel.id)
          ) ?? null;
        return withinPanelPosition(referencePanel.id, referenceGroup);
      }
      if (activeGroup) {
        return withinGroupPosition(activeGroup);
      }
      return { direction: "right" as const };
    })();
    const context =
      opts && Object.hasOwn(opts, "context")
        ? (opts.context ?? undefined)
        : inheritedActiveTerminalContext(api);
    const params = terminalPanelParams({
      ...(opts?.backgroundCreate && {
        backgroundCreate: opts.backgroundCreate,
      }),
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
    const params = resolveSplitPanelParams(component, panel);
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

function resolveSplitPanelParams(
  component: string,
  panel: { id: string; params?: object | undefined }
): Record<string, unknown> | undefined {
  if (component === "terminal") {
    if (
      useTerminalPreferencesStore.getState().terminalNewCwdPolicy !==
      "activeTerminal"
    ) {
      return;
    }
    const context = terminalPanelContext(panel.id);
    return context ? { context } : undefined;
  }
  if (component === PANEL_TAB_FILE_COMPONENT_ID) {
    const existing = (panel.params ?? {}) as Record<string, unknown>;
    return {
      ...(existing.context === undefined ? {} : { context: existing.context }),
      pinned: true,
      ...(existing.source === undefined ? {} : { source: existing.source }),
    };
  }
  const existing = panel.params;
  if (!existing) {
    return;
  }
  return { ...existing };
}
