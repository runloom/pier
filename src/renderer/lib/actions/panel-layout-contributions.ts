import i18next from "i18next";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelsTopLeft,
  PanelTop,
} from "lucide-react";
import { toast } from "sonner";
import {
  captureDomSelectionText,
  runSelectionSelectAll,
  selectedTextFromInvocation,
  surfaceHasLocalCopyAction,
} from "@/lib/context-menu/selection-text.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import type { ActionContribution } from "./contribution-types.ts";
import { resolvePanelCopyPath } from "./panel-copy-path.ts";

function activePanelId(): string | null {
  return useWorkspaceStore.getState().api?.activePanel?.id ?? null;
}

async function writeClipboardText(text: string): Promise<void> {
  if (window.pier?.clipboard?.writeText) {
    await window.pier.clipboard.writeText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

export const PANEL_LAYOUT_ACTION_CONTRIBUTIONS: readonly ActionContribution[] =
  [
    {
      categoryKey: "panel",
      group: "0_edit",
      handler: async (invocation) => {
        // 主路径：菜单项 clipboardText 已在 main click 时写入系统剪贴板。
        // 这里再写一次作为兜底（快捷键/命令面板等不经菜单的入口）。
        const text =
          selectedTextFromInvocation(invocation) ||
          captureDomSelectionText(invocation?.sourcePanelId);
        if (text.length === 0) {
          return;
        }
        try {
          await writeClipboardText(text);
        } catch (error) {
          showAppAlert({
            body: error instanceof Error ? error.message : String(error),
            title: i18next.t("contextMenu.action.clipboardFailed"),
          });
        }
      },
      id: "pier.panel.copySelection",
      // 终端/文件编辑器自带复制，不在那些 surface 重复。
      enabled: (invocation) => {
        const text =
          selectedTextFromInvocation(invocation) ||
          captureDomSelectionText(invocation?.sourcePanelId);
        return text.length > 0;
      },
      menuHidden: (invocation) =>
        surfaceHasLocalCopyAction(invocation?.surface),
      sortOrder: 0,
      surfaces: ["panel/content"],
      titleKey: "contextMenu.action.copy",
    },
    {
      categoryKey: "panel",
      group: "0_edit",
      handler: async (invocation) => {
        const path = resolvePanelCopyPath(invocation);
        if (!path) {
          return;
        }
        try {
          await writeClipboardText(path);
          toast.success(i18next.t("contextMenu.action.pathCopied"));
        } catch (error) {
          await showAppAlert({
            body: error instanceof Error ? error.message : String(error),
            title: i18next.t("contextMenu.action.clipboardFailed"),
          });
        }
      },
      id: "pier.panel.copyPath",
      // 无持有路径时整行移除，不置灰。
      menuHidden: (invocation) => resolvePanelCopyPath(invocation) == null,
      sortOrder: 2,
      surfaces: ["dockview-tab"],
      titleKey: "contextMenu.action.copyPath",
    },
    {
      categoryKey: "panel",
      group: "0_edit",
      handler: async (invocation) => {
        runSelectionSelectAll(invocation?.sourcePanelId);
      },
      id: "pier.panel.selectAll",
      menuHidden: (invocation) =>
        surfaceHasLocalCopyAction(invocation?.surface),
      sortOrder: 1,
      surfaces: ["panel/content"],
      titleKey: "contextMenu.action.selectAll",
    },
    {
      categoryKey: "panel",
      group: "9_close",
      handler: async () => {
        await useWorkspaceStore.getState().closeActivePanel();
      },
      id: "pier.panel.closeActive",
      surfaces: [],
      titleKey: "commandPalette.action.closeActivePanel",
      when: "workspace.hasActivePanel",
    },
    {
      categoryKey: "panel",
      group: "4_layout",
      handler: () => useWorkspaceStore.getState().toggleActivePanelMaximized(),
      id: "pier.panel.toggleMaximized",
      // 最大化只走 header 按钮 / 命令面板 / 快捷键，不进任何右键菜单。
      // 无分屏时最大化无意义（与 equalize / 组导航同一门槛）。
      surfaces: ["command-palette"],
      titleKey: "commandPalette.action.togglePanelMaximize",
      when: "workspace.groupCount > 1",
    },
    {
      categoryKey: "panel",
      group: "4_layout",
      handler: () => useWorkspaceStore.getState().equalizeSplits(),
      iconComponent: PanelsTopLeft,
      id: "pier.panel.equalizeSplits",
      sortOrder: 1,
      surfaces: ["panel/content", "command-palette"],
      titleKey: "commandPalette.action.equalizePanels",
      when: "workspace.groupCount > 1",
    },
    {
      categoryKey: "panel",
      group: "9_close",
      handler: async (invocation) => {
        // tab × / 右键菜单带 sourcePanelId；快捷键无 invocation 时退回 active。
        const panelId = invocation?.sourcePanelId ?? activePanelId();
        if (panelId) {
          await useWorkspaceStore.getState().closePanel(panelId);
        }
      },
      id: "pier.panel.close",
      sortOrder: 1,
      shortcutSourceId: "pier.panel.closeActive",
      surfaces: ["dockview-tab"],
      titleKey: "contextMenu.action.closePanel",
      when: "workspace.hasActivePanel",
    },
    {
      categoryKey: "panel",
      group: "9_close",
      handler: async (invocation) => {
        const panelId = invocation?.sourcePanelId ?? activePanelId();
        if (panelId) {
          await useWorkspaceStore.getState().closeOthers(panelId);
        }
      },
      id: "pier.panel.closeOthers",
      sortOrder: 2,
      surfaces: ["dockview-tab"],
      titleKey: "contextMenu.action.closeOthers",
      when: "workspace.activeGroupPanelCount > 1",
    },
    {
      categoryKey: "panel",
      group: "2_split",
      handler: () => {
        const panelId = activePanelId();
        if (panelId) {
          useWorkspaceStore.getState().splitPanel(panelId, "right");
        }
      },
      iconComponent: PanelRight,
      id: "pier.panel.splitRight",
      // 任务面板右键菜单不提供拆分 (整个 split 子菜单隐藏)。
      menuHiddenWhen: "terminal.activeIsTaskPanel",
      sortOrder: 1,
      submenuKey: "contextMenu.submenu.split",
      surfaces: ["terminal/content"],
      titleKey: "contextMenu.action.splitRight",
      when: "terminal.hasActivePanel",
    },
    {
      categoryKey: "panel",
      group: "2_split",
      handler: () => {
        const panelId = activePanelId();
        if (panelId) {
          useWorkspaceStore.getState().splitPanel(panelId, "below");
        }
      },
      iconComponent: PanelBottom,
      id: "pier.panel.splitDown",
      menuHiddenWhen: "terminal.activeIsTaskPanel",
      sortOrder: 2,
      submenuKey: "contextMenu.submenu.split",
      surfaces: ["terminal/content"],
      titleKey: "contextMenu.action.splitDown",
      when: "terminal.hasActivePanel",
    },
    {
      categoryKey: "panel",
      group: "2_split",
      handler: () => {
        const panelId = activePanelId();
        if (panelId) {
          useWorkspaceStore.getState().splitPanel(panelId, "left");
        }
      },
      iconComponent: PanelLeft,
      id: "pier.panel.splitLeft",
      menuHiddenWhen: "terminal.activeIsTaskPanel",
      sortOrder: 3,
      submenuKey: "contextMenu.submenu.split",
      surfaces: ["terminal/content"],
      titleKey: "contextMenu.action.splitLeft",
      when: "terminal.hasActivePanel",
    },
    {
      categoryKey: "panel",
      group: "2_split",
      handler: () => {
        const panelId = activePanelId();
        if (panelId) {
          useWorkspaceStore.getState().splitPanel(panelId, "above");
        }
      },
      iconComponent: PanelTop,
      id: "pier.panel.splitUp",
      menuHiddenWhen: "terminal.activeIsTaskPanel",
      sortOrder: 4,
      submenuKey: "contextMenu.submenu.split",
      surfaces: ["terminal/content"],
      titleKey: "contextMenu.action.splitUp",
      when: "terminal.hasActivePanel",
    },
    {
      categoryKey: "panel",
      excludeFromMru: true,
      group: "3_focus",
      handler: (invocation) =>
        useWorkspaceStore
          .getState()
          .focusGroup("right", invocation?.sourcePanelId),
      iconComponent: ArrowRight,
      id: "pier.panel.focusRight",
      sortOrder: 1,
      submenuKey: "contextMenu.submenu.focus",
      surfaces: ["panel/content"],
      titleKey: "contextMenu.action.focusRight",
      when: "workspace.groupCount > 1",
    },
    {
      categoryKey: "panel",
      excludeFromMru: true,
      group: "3_focus",
      handler: (invocation) =>
        useWorkspaceStore
          .getState()
          .focusGroup("down", invocation?.sourcePanelId),
      iconComponent: ArrowDown,
      id: "pier.panel.focusDown",
      sortOrder: 2,
      submenuKey: "contextMenu.submenu.focus",
      surfaces: ["panel/content"],
      titleKey: "contextMenu.action.focusDown",
      when: "workspace.groupCount > 1",
    },
    {
      categoryKey: "panel",
      excludeFromMru: true,
      group: "3_focus",
      handler: (invocation) =>
        useWorkspaceStore
          .getState()
          .focusGroup("left", invocation?.sourcePanelId),
      iconComponent: ArrowLeft,
      id: "pier.panel.focusLeft",
      sortOrder: 3,
      submenuKey: "contextMenu.submenu.focus",
      surfaces: ["panel/content"],
      titleKey: "contextMenu.action.focusLeft",
      when: "workspace.groupCount > 1",
    },
    {
      categoryKey: "panel",
      excludeFromMru: true,
      group: "3_focus",
      handler: (invocation) =>
        useWorkspaceStore
          .getState()
          .focusGroup("up", invocation?.sourcePanelId),
      iconComponent: ArrowUp,
      id: "pier.panel.focusUp",
      sortOrder: 4,
      submenuKey: "contextMenu.submenu.focus",
      surfaces: ["panel/content"],
      titleKey: "contextMenu.action.focusUp",
      when: "workspace.groupCount > 1",
    },
  ];
