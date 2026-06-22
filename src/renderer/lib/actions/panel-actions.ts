/**
 * Panel + Window 相关 action 注册. 在 WorkspaceHost mount 时调用一次.
 *
 * 新增 action 时:
 *   1. 在 actionRegistry.register({ id: "pier.<domain>.<name>", ... })
 *   2. 在 keybindings/defaults.ts 加对应 keymap (如需快捷键)
 */
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
      title: () => "Close Active Panel",
    })
  );

  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api != null,
      handler: () => useWorkspaceStore.getState().addTab(),
      id: "pier.panel.newTab",
      title: () => "New Tab",
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
      title: () => "New Window",
    })
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
