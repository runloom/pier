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
      surfaces: [],
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
      surfaces: [],
      title: () => "New Window",
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
