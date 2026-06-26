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
import { Plus, RotateCcw } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type {
  ActionContributionRuntime,
  ActionWhenContext,
} from "@/lib/actions/contribution-types.ts";
import { PANEL_LAYOUT_ACTION_CONTRIBUTIONS } from "@/lib/actions/panel-layout-contributions.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { createWindow } from "@/lib/ipc/window-ipc.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function workspaceActionContext(): ActionWhenContext {
  const api = useWorkspaceStore.getState().api;
  return {
    workspace: {
      activeGroupPanelCount: api?.activeGroup?.panels?.length ?? 0,
      groupCount: api?.groups?.length ?? 0,
      hasActivePanel: api?.activePanel != null,
      hasApi: api != null,
      panelCount: api?.panels?.length ?? 0,
    },
  };
}

function resolveI18nAliases(key: string): readonly string[] {
  const value = i18next.t(key, { returnObjects: true });
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

const actionContributionRuntime: ActionContributionRuntime = {
  getContext: workspaceActionContext,
  resolveAliases: resolveI18nAliases,
  t: (key) => i18next.t(key),
};

export function registerPanelActions(): () => void {
  const disposers: Array<() => void> = registerActionContributions(
    PANEL_LAYOUT_ACTION_CONTRIBUTIONS,
    actionContributionRuntime
  );

  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api != null,
      handler: () => useWorkspaceStore.getState().addTab(),
      id: "pier.panel.newTab",
      metadata: { group: "1_new" },
      surfaces: [],
      title: () => i18next.t("commandPalette.action.newTab"),
    })
  );

  disposers.push(
    actionRegistry.register({
      category: "Run",
      enabled: () => useWorkspaceStore.getState().api != null,
      handler: () => {
        useWorkspaceStore.getState().addTerminal();
      },
      id: "pier.panel.newTerminal",
      metadata: { group: "1_new", iconComponent: Plus, sortOrder: 1 },
      surfaces: ["dockview-tab", "terminal/content", "command-palette"],
      title: () => i18next.t("contextMenu.action.newTerminal"),
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
      title: () => i18next.t("commandPalette.action.newWindow"),
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
