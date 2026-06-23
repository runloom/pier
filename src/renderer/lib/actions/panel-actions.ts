/**
 * Panel + Window 相关 action 注册. 多数走快捷键触发, 不在命令面板展示 (和 bay 一致);
 * resetLayout 例外 — 无快捷键, 仅命令面板展示 (避免误触发).
 *
 * 新增 action 时:
 *   1. 在 actionRegistry.register({ id: "pier.<domain>.<name>", ... })
 *   2. 在 keybindings/defaults.ts 加对应 keymap (如需快捷键)
 *   3. 在命令面板展示时, surfaces: ["command-palette"] + i18n title key + icon
 */
import i18next from "i18next";
import { RotateCcw } from "lucide-react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { createWindow } from "@/lib/ipc/window-ipc.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

export function registerPanelActions(): () => void {
  const disposers: Array<() => void> = [];

  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
      handler: () => useWorkspaceStore.getState().closeActivePanel(),
      id: "pier.panel.closeActive",
      metadata: { group: "9_close" },
      surfaces: [],
      title: () => "Close Active Panel",
    })
  );

  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api != null,
      handler: () => useWorkspaceStore.getState().addTab(),
      id: "pier.panel.newTab",
      metadata: { group: "1_new" },
      surfaces: [],
      title: () => "New Tab",
    })
  );

  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api != null,
      handler: () => useWorkspaceStore.getState().addTerminal(),
      id: "pier.panel.newTerminal",
      metadata: { group: "1_new", sortOrder: 1 },
      surfaces: ["dockview-tab"],
      title: () => "New Terminal",
    })
  );

  disposers.push(
    actionRegistry.register({
      category: "Window",
      handler: () => {
        createWindow().catch((err) => {
          console.error("[actions] newWindow failed:", err);
        });
      },
      id: "pier.window.newWindow",
      metadata: { group: "1_new" },
      surfaces: [],
      title: () => "New Window",
    })
  );

  // ─── dockview-tab surface actions ───────────────────────────────────
  // 右键 tab 时 dockview 先把该 tab 设为 activePanel (onPointerDown), 再 fire
  // onContextMenu — 所以 handler 用 activePanel 等价于"右键的那个 tab".
  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
      handler: () => {
        const api = useWorkspaceStore.getState().api;
        const p = api?.activePanel;
        if (p) {
          useWorkspaceStore.getState().closePanel(p.id);
        }
      },
      id: "pier.panel.close",
      metadata: { group: "9_close", sortOrder: 1 },
      surfaces: ["dockview-tab"],
      title: () => i18next.t("contextMenu.action.closePanel"),
    })
  );

  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => {
        const api = useWorkspaceStore.getState().api;
        return api != null && api.panels.length > 1;
      },
      handler: () => {
        const api = useWorkspaceStore.getState().api;
        const p = api?.activePanel;
        if (p) {
          useWorkspaceStore.getState().closeOthers(p.id);
        }
      },
      id: "pier.panel.closeOthers",
      metadata: { group: "9_close", sortOrder: 2 },
      surfaces: ["dockview-tab"],
      title: () => i18next.t("contextMenu.action.closeOthers"),
    })
  );

  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => {
        const api = useWorkspaceStore.getState().api;
        return api != null && api.panels.length > 0;
      },
      handler: () => useWorkspaceStore.getState().closeAll(),
      id: "pier.panel.closeAll",
      metadata: { group: "9_close", sortOrder: 3 },
      surfaces: ["dockview-tab"],
      title: () => i18next.t("contextMenu.action.closeAll"),
    })
  );

  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
      handler: () => {
        const api = useWorkspaceStore.getState().api;
        const p = api?.activePanel;
        if (p) {
          useWorkspaceStore.getState().splitPanel(p.id, "right");
        }
      },
      id: "pier.panel.splitRight",
      metadata: { group: "2_split", sortOrder: 1 },
      surfaces: ["dockview-tab"],
      title: () => i18next.t("contextMenu.action.splitRight"),
    })
  );

  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
      handler: () => {
        const api = useWorkspaceStore.getState().api;
        const p = api?.activePanel;
        if (p) {
          useWorkspaceStore.getState().splitPanel(p.id, "below");
        }
      },
      id: "pier.panel.splitDown",
      metadata: { group: "2_split", sortOrder: 2 },
      surfaces: ["dockview-tab"],
      title: () => i18next.t("contextMenu.action.splitDown"),
    })
  );

  // 重置布局 — 只在命令面板展示, 无快捷键. 删 disk layout + 清所有 panel + 重建
  // default terminal panel. 适用于 layout 累积乱了想回到干净状态时.
  disposers.push(
    actionRegistry.register({
      category: "Workspace",
      enabled: () => useWorkspaceStore.getState().api != null,
      handler: () => {
        useWorkspaceStore
          .getState()
          .resetLayout()
          .catch((err) => {
            console.error("[actions] resetLayout failed:", err);
          });
      },
      id: "pier.workspace.resetLayout",
      metadata: {
        group: "z_workspace",
        iconComponent: RotateCcw,
        keywords: ["reset", "layout", "重置", "布局", "panel", "面板"],
        sortOrder: 6,
      },
      surfaces: ["command-palette"],
      title: () => i18next.t("commandPalette.action.resetLayout"),
    })
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
