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
  hasSpecializedEditPipelineSurface,
  runSelectionSelectAll,
  selectedTextFromInvocation,
} from "@/lib/context-menu/selection-text.ts";
import {
  PANEL_EDIT_SURFACE,
  PANEL_LAYOUT_SURFACE,
} from "@/lib/context-menu/surface-profiles.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { panelsInSameGroup } from "@/stores/workspace-panel-helpers.ts";
import type { ActionContribution } from "./contribution-types.ts";
import { resolvePanelCopyPath } from "./panel-copy-path.ts";
import { PANEL_WINDOW_ACTION_CONTRIBUTIONS } from "./panel-window-contributions.ts";
import type { ActionInvocation } from "./types.ts";

const PANEL_TAB_FILE_COMPONENT_ID = "pier.files.filePanel";

function resolveTabPanel(invocation?: ActionInvocation) {
  const api = useWorkspaceStore.getState().api;
  const panelId = invocation?.sourcePanelId ?? api?.activePanel?.id;
  if (!(api && panelId)) {
    return null;
  }
  return api.panels.find((panel) => panel.id === panelId) ?? null;
}

function isPreviewFileTab(invocation?: ActionInvocation): boolean {
  const panel = resolveTabPanel(invocation);
  if (!panel || panel.view?.contentComponent !== PANEL_TAB_FILE_COMPONENT_ID) {
    return false;
  }
  const params = panel.params as { pinned?: unknown } | undefined;
  return params?.pinned === false;
}

function activePanelId(): string | null {
  return useWorkspaceStore.getState().api?.activePanel?.id ?? null;
}

function hasPanelsToTheRight(invocation?: { sourcePanelId?: string }): boolean {
  const api = useWorkspaceStore.getState().api;
  const panelId = invocation?.sourcePanelId ?? activePanelId();
  if (!(api && panelId)) {
    return false;
  }
  try {
    const groupPanels = panelsInSameGroup(api, panelId);
    const index = groupPanels.findIndex((panel) => panel.id === panelId);
    return index >= 0 && index < groupPanels.length - 1;
  } catch {
    return false;
  }
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
    ...PANEL_WINDOW_ACTION_CONTRIBUTIONS,
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
        hasSpecializedEditPipelineSurface(invocation?.surface),
      sortOrder: 0,
      surfaces: [PANEL_EDIT_SURFACE],
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
      handler: (invocation) => {
        const panel = resolveTabPanel(invocation);
        if (!panel) {
          return;
        }
        // Preview → pinned（与双击 promote 同语义）。
        panel.api.updateParameters({ pinned: true });
      },
      id: "pier.panel.keepOpen",
      menuHidden: (invocation) => !isPreviewFileTab(invocation),
      sortOrder: 3,
      surfaces: ["dockview-tab"],
      titleKey: "contextMenu.action.keepOpen",
    },
    {
      categoryKey: "panel",
      group: "0_edit",
      handler: async (invocation) => {
        runSelectionSelectAll(invocation?.sourcePanelId);
      },
      id: "pier.panel.selectAll",
      menuHidden: (invocation) =>
        hasSpecializedEditPipelineSurface(invocation?.surface),
      sortOrder: 1,
      surfaces: [PANEL_EDIT_SURFACE],
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
      // 单 group 整行移除（非置灰）；命令面板仍走 when 置灰/拦截。
      menuHiddenWhen: "!workspace.groupCount > 1",
      sortOrder: 1,
      surfaces: [PANEL_LAYOUT_SURFACE, "command-palette"],
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
      // 单 tab 组整行移除，不置灰。
      menuHiddenWhen: "!workspace.activeGroupPanelCount > 1",
      sortOrder: 2,
      surfaces: ["dockview-tab"],
      titleKey: "contextMenu.action.closeOthers",
      when: "workspace.activeGroupPanelCount > 1",
    },
    {
      categoryKey: "panel",
      group: "9_close",
      handler: async (invocation) => {
        const panelId = invocation?.sourcePanelId ?? activePanelId();
        if (panelId) {
          await useWorkspaceStore.getState().closeToTheRight(panelId);
        }
      },
      id: "pier.panel.closeToTheRight",
      menuHidden: (invocation) => !hasPanelsToTheRight(invocation),
      sortOrder: 3,
      surfaces: ["dockview-tab"],
      titleKey: "contextMenu.action.closeToTheRight",
    },
    {
      categoryKey: "panel",
      group: "9_close",
      handler: async (invocation) => {
        // 关闭同组全部标签；sole-group 卸完后关窗（store.closeGroup）。
        const panelId = invocation?.sourcePanelId ?? activePanelId();
        if (panelId) {
          await useWorkspaceStore.getState().closeGroup(panelId);
        }
      },
      id: "pier.panel.closeGroup",
      menuHiddenWhen: "!workspace.activeGroupPanelCount > 1",
      sortOrder: 4,
      surfaces: ["dockview-tab"],
      titleKey: "contextMenu.action.closeGroup",
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
      menuHiddenWhen: "!workspace.groupCount > 1",
      sortOrder: 1,
      submenuKey: "contextMenu.submenu.focus",
      surfaces: [PANEL_LAYOUT_SURFACE],
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
      menuHiddenWhen: "!workspace.groupCount > 1",
      sortOrder: 2,
      submenuKey: "contextMenu.submenu.focus",
      surfaces: [PANEL_LAYOUT_SURFACE],
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
      menuHiddenWhen: "!workspace.groupCount > 1",
      sortOrder: 3,
      submenuKey: "contextMenu.submenu.focus",
      surfaces: [PANEL_LAYOUT_SURFACE],
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
      menuHiddenWhen: "!workspace.groupCount > 1",
      sortOrder: 4,
      submenuKey: "contextMenu.submenu.focus",
      surfaces: [PANEL_LAYOUT_SURFACE],
      titleKey: "contextMenu.action.focusUp",
      when: "workspace.groupCount > 1",
    },
  ];
