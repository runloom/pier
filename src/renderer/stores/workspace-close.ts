import type { DockviewApi } from "dockview-react";
import { isWorkspaceBootstrapGateActive } from "@/components/workspace/bootstrap-gate.ts";
import {
  hangBreadcrumbNow,
  noteHangBreadcrumb,
} from "@/lib/diagnostics/hang-breadcrumb.ts";
import { closeCurrentWindow } from "@/lib/ipc/window-ipc.ts";
import { runPanelCloseGuards } from "@/lib/workspace/panel-close-guards.ts";
import { activatePanelCloseSuccessor } from "@/lib/workspace/panel-close-successor.ts";
import {
  clearCurrentWindowLayout,
  panelsInSameGroup,
} from "@/stores/workspace-panel-helpers.ts";
import { useWorkspacePreferencesStore } from "@/stores/workspace-preferences.store.ts";
import { closeNativeTerminalPanel } from "@/stores/workspace-terminal-close.ts";

export type WorkspaceCloseGet = () => {
  api: DockviewApi | null;
};

export async function closeActivePanel(
  get: WorkspaceCloseGet
): Promise<boolean> {
  if (isWorkspaceBootstrapGateActive()) {
    return false;
  }
  const api = get().api;
  if (!api) {
    return false;
  }
  const panel = api.activePanel;
  if (!panel) {
    return false;
  }
  const startedAt = hangBreadcrumbNow();
  const componentId = panel.view.contentComponent;
  noteHangBreadcrumb({
    kind: "panel-close",
    phase: "start",
    commandId: "pier.panel.closeActive",
    activePanelComponent: componentId,
    panelId: panel.id,
    detail: "closeActive",
  });
  const allowed = await runPanelCloseGuards({
    closingPanelIds: [panel.id],
    componentId,
    panelId: panel.id,
    params: panel.params,
  });
  if (!allowed) {
    noteHangBreadcrumb({
      kind: "panel-close",
      phase: "end",
      commandId: "pier.panel.closeActive",
      activePanelComponent: componentId,
      panelId: panel.id,
      detail: "guard-rejected",
      elapsedMs: Math.round(hangBreadcrumbNow() - startedAt),
    });
    return false;
  }
  // 全局仅剩最后一个 panel → 关窗口 (而非删 panel 留空 group).
  if (api.totalPanels <= 1) {
    if (componentId === "terminal") {
      closeNativeTerminalPanel(panel.id);
    }
    closeCurrentWindow().catch((err) => {
      console.error("[workspace] closeCurrentWindow failed:", err);
    });
    noteHangBreadcrumb({
      kind: "panel-close",
      phase: "end",
      commandId: "pier.panel.closeActive",
      activePanelComponent: componentId,
      panelId: panel.id,
      detail: "close-window-last-panel",
      elapsedMs: Math.round(hangBreadcrumbNow() - startedAt),
    });
    return true;
  }
  // adjacent：关 active 时先切邻接 tab；recent：交给 dockview 组内 MRU。
  activatePanelCloseSuccessor({
    activePanelId: api.activePanel?.id,
    closingPanelId: panel.id,
    groupPanels: panelsInSameGroup(api, panel.id),
    policy: useWorkspacePreferencesStore.getState().panelCloseFocusPolicy,
  });
  // 主动先发 native close IPC, 再 removePanel；不把 React unmount 当显式关闭.
  // 用 contentComponent 而非 params?.component: 前者是 dockview stable key.
  if (componentId === "terminal") {
    closeNativeTerminalPanel(panel.id);
  }
  api.removePanel(panel);
  noteHangBreadcrumb({
    kind: "panel-close",
    phase: "end",
    commandId: "pier.panel.closeActive",
    activePanelComponent: componentId,
    panelId: panel.id,
    detail: "removePanel",
    elapsedMs: Math.round(hangBreadcrumbNow() - startedAt),
  });
  return true;
}

export async function closePanel(
  get: WorkspaceCloseGet,
  panelId: string
): Promise<boolean> {
  if (isWorkspaceBootstrapGateActive()) {
    return false;
  }
  const api = get().api;
  if (!api) {
    return false;
  }
  const panel = api.panels.find((p) => p.id === panelId);
  if (!panel) {
    return false;
  }
  const startedAt = hangBreadcrumbNow();
  const componentId = panel.view.contentComponent;
  // Tab × / pier.panel.close — distinct from closeActive (⌘W).
  noteHangBreadcrumb({
    kind: "panel-close",
    phase: "start",
    commandId: "pier.panel.close",
    activePanelComponent: componentId,
    panelId: panel.id,
    detail: "closePanel",
  });
  const allowed = await runPanelCloseGuards({
    closingPanelIds: [panel.id],
    componentId,
    panelId: panel.id,
    params: panel.params,
  });
  if (!allowed) {
    noteHangBreadcrumb({
      kind: "panel-close",
      phase: "end",
      commandId: "pier.panel.close",
      activePanelComponent: componentId,
      panelId: panel.id,
      detail: "guard-rejected",
      elapsedMs: Math.round(hangBreadcrumbNow() - startedAt),
    });
    return false;
  }
  // 同 closeActivePanel: 全局仅剩最后一个 panel → 关窗口 (而非留空 group).
  if (api.totalPanels <= 1) {
    if (componentId === "terminal") {
      closeNativeTerminalPanel(panel.id);
    }
    closeCurrentWindow().catch((err) => {
      console.error("[workspace] closeCurrentWindow failed:", err);
    });
    noteHangBreadcrumb({
      kind: "panel-close",
      phase: "end",
      commandId: "pier.panel.close",
      activePanelComponent: componentId,
      panelId: panel.id,
      detail: "close-window-last-panel",
      elapsedMs: Math.round(hangBreadcrumbNow() - startedAt),
    });
    return true;
  }
  // 关 inactive：不改 active。关 active：按 panelCloseFocusPolicy 选 successor。
  activatePanelCloseSuccessor({
    activePanelId: api.activePanel?.id,
    closingPanelId: panel.id,
    groupPanels: panelsInSameGroup(api, panel.id),
    policy: useWorkspacePreferencesStore.getState().panelCloseFocusPolicy,
  });
  if (componentId === "terminal") {
    closeNativeTerminalPanel(panel.id);
  }
  api.removePanel(panel);
  noteHangBreadcrumb({
    kind: "panel-close",
    phase: "end",
    commandId: "pier.panel.close",
    activePanelComponent: componentId,
    panelId: panel.id,
    detail: "removePanel",
    elapsedMs: Math.round(hangBreadcrumbNow() - startedAt),
  });
  return true;
}

export async function closeOthers(
  get: WorkspaceCloseGet,
  panelId: string
): Promise<void> {
  if (isWorkspaceBootstrapGateActive()) {
    return;
  }
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
}

export async function closeToTheRight(
  get: WorkspaceCloseGet,
  panelId: string
): Promise<void> {
  if (isWorkspaceBootstrapGateActive()) {
    return;
  }
  const api = get().api;
  if (!api) {
    return;
  }
  const groupPanels = panelsInSameGroup(api, panelId);
  const index = groupPanels.findIndex((panel) => panel.id === panelId);
  if (index < 0 || index >= groupPanels.length - 1) {
    return;
  }
  const toClose = groupPanels.slice(index + 1);
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
}

export async function closeGroup(
  get: WorkspaceCloseGet,
  panelId: string
): Promise<void> {
  if (isWorkspaceBootstrapGateActive()) {
    return;
  }
  const api = get().api;
  if (!api) {
    return;
  }
  const groupPanels = [...panelsInSameGroup(api, panelId)];
  if (groupPanels.length === 0) {
    return;
  }
  const closingPanelIds = groupPanels.map((p) => p.id);
  // 批量 removePanel，避免逐个 closePanel 在 sole-group 倒数第二项之后
  // 触发「最后一 panel 关窗」而中断循环语义。
  for (const p of groupPanels) {
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
  // sole-group 卸完：与 closeAll 对称关窗，不留空 dockview。
  const remaining = get().api?.panels.length ?? 0;
  if (remaining === 0) {
    try {
      await clearCurrentWindowLayout();
    } catch (err) {
      console.error("[workspace] clearLayout failed:", err);
    }
    closeCurrentWindow().catch((err) => {
      console.error("[workspace] closeCurrentWindow failed:", err);
    });
  }
}

export async function closeAll(get: WorkspaceCloseGet): Promise<void> {
  if (isWorkspaceBootstrapGateActive()) {
    return;
  }
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
}
