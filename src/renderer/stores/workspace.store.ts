import type { PierCommandPlacement } from "@shared/contracts/commands.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { DockviewApi } from "dockview-react";
import { create } from "zustand";
import { closeCurrentWindow } from "@/lib/ipc/window-ipc.ts";
import { pickFocusTarget } from "@/lib/workspace/focus-target.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import { scheduleRevealDockviewTabByPanelId } from "@/lib/workspace/tab-visibility.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useTerminalPreferencesStore } from "@/stores/terminal-preferences.store.ts";

interface WorkspaceState {
  addPanel: (opts: {
    component: string;
    id: string;
    params?: TerminalPanelParams;
    title: string;
  }) => void;
  addTab: () => void;
  addTerminal: (opts?: {
    context?: PanelContext;
    placement?: PierCommandPlacement;
    referenceGroup?: WorkspaceGroupRef;
  }) => string | null;
  api: DockviewApi | null;
  closeActivePanel: () => void;
  closeAll: () => Promise<void>;
  closeOthers: (panelId: string) => void;
  closePanel: (panelId: string) => void;
  focusGroup: (direction: "right" | "down" | "left" | "up") => void;
  hasMaximizedGroup: boolean;
  resetLayout: () => Promise<void>;
  setApi: (api: DockviewApi | null) => void;
  setHasMaximizedGroup: (hasMaximizedGroup: boolean) => void;
  splitPanel: (
    panelId: string,
    direction: "right" | "below" | "left" | "above"
  ) => void;
  toggleActivePanelMaximized: () => void;
}

interface TerminalPanelParams {
  context: PanelContext;
}

type WorkspaceGroupRef = NonNullable<DockviewApi["activeGroup"]>;

function terminalPanelContext(
  panelId: string | undefined
): PanelContext | undefined {
  if (!panelId) {
    return;
  }
  return usePanelDescriptorStore.getState().descriptors[panelId]?.context;
}

function inheritedActiveTerminalContext(
  api: DockviewApi
): PanelContext | undefined {
  if (
    useTerminalPreferencesStore.getState().terminalNewCwdPolicy !==
    "activeTerminal"
  ) {
    return;
  }
  const activePanel = api.activePanel;
  if (activePanel?.view.contentComponent !== "terminal") {
    return;
  }
  return terminalPanelContext(activePanel.id);
}

function uniquePanelId(api: DockviewApi, prefix: string): string {
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

/**
 * 拿 dockview group 的 HTMLElement. dockview 没把 group.element 列入 public API,
 * cast + instanceof 守卫: 升级 dockview 若改 group 类型, focus 安全降级为 no-op
 * 而非 crash.
 */
function getGroupElement(g: unknown): HTMLElement | null {
  const el = (g as { element?: HTMLElement } | null)?.element;
  return el instanceof HTMLElement ? el : null;
}

/**
 * = pierTheme.gap (4) + 1. 改 gap 必须同步此常量.
 * 容忍像素让相邻 group 的边界比较不被 gap 卡掉.
 */
const FOCUS_TOL_PX = 5;

async function clearCurrentWindowLayout(): Promise<void> {
  const context = await window.pier.getWindowContext();
  await window.pier.workspace.clearLayout(context.recordId);
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  api: null,
  hasMaximizedGroup: false,
  setApi: (api) => set({ api, hasMaximizedGroup: false }),
  setHasMaximizedGroup: (hasMaximizedGroup) => set({ hasMaximizedGroup }),
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
    const params = context ? { context } : undefined;
    const titlePath = context?.cwd;
    api.addPanel({
      id,
      component: "terminal",
      title: titlePath ? `Terminal: ${titlePath}` : "Terminal",
      ...(params && { params }),
      position: position ?? fallbackPosition,
    });
    scheduleRevealDockviewTabByPanelId(id);
    return id;
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
      if (panel.view.contentComponent === "terminal") {
        window.pier?.terminal?.close?.(panel.id);
      }
      closeCurrentWindow().catch((err) => {
        console.error("[workspace] closeCurrentWindow failed:", err);
      });
      return;
    }
    // 主动先发 native terminal close IPC, 再 removePanel — native session 生命周期
    // 只绑定显式 workspace close 操作, 不绑定 React unmount. 这样 Electron reload
    // 卸载 renderer tree 时不会误杀可复用的 Ghostty surface / PTY.
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
      if (panel.view.contentComponent === "terminal") {
        window.pier?.terminal?.close?.(panel.id);
      }
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

  closeAll: async () => {
    const api = get().api;
    if (!api) {
      return;
    }
    // 先清磁盘 layout — 防 removePanel 触发的 debounced save 与 closeCurrentWindow 时序
    // 竞争把空 layout 写入磁盘 (下次启动 fromJSON 拿到空 panel list 应用为空 workspace).
    try {
      await clearCurrentWindowLayout();
    } catch (err) {
      console.error("[workspace] clearLayout failed:", err);
    }
    const all = [...api.panels];
    for (const p of all) {
      if (p.view.contentComponent === "terminal") {
        window.pier?.terminal?.close?.(p.id);
      }
      api.removePanel(p);
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
    scheduleRevealDockviewTabByPanelId(newId);
  },

  focusGroup: (direction) => {
    const api = get().api;
    if (!api) {
      return;
    }
    const active = api.activeGroup;
    if (!active) {
      return;
    }
    if (api.groups.length < 2) {
      return;
    }

    const activeEl = getGroupElement(active);
    if (!activeEl) {
      return;
    }
    const activeRect = activeEl.getBoundingClientRect();

    const candidates = api.groups.map((g) => ({
      id: g.id,
      isActive: g.id === active.id,
      rect: getGroupElement(g)?.getBoundingClientRect() ?? null,
    }));
    const targetIdx = pickFocusTarget(
      activeRect,
      candidates,
      direction,
      FOCUS_TOL_PX
    );
    if (targetIdx === null) {
      return;
    }

    const targetGroup = api.groups[targetIdx];
    if (!targetGroup) {
      return;
    }
    const targetPanel = targetGroup.activePanel ?? targetGroup.panels[0];
    if (!targetPanel) {
      return;
    }

    // 写回 dockview 单源 — onDidActivePanelChange 回调会自动联动
    // DescriptorStore / KeybindingScope / Swift firstResponder.
    activateWorkspacePanel(api, targetPanel.id, {
      reveal: "always",
    });
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
    scheduleRevealDockviewTabByPanelId("terminal-1");
  },
}));
