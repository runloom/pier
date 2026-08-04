import { AppWindow } from "lucide-react";
import {
  canCopyPanelToWindow,
  canMovePanelToWindow,
  copyPanelToNewWindow,
  copyPanelToOtherWindow,
  movePanelToNewWindow,
  movePanelToOtherWindow,
  resolveRelocatePanelId,
} from "@/components/workspace/transfer/relocate.ts";
import type { ActionContribution } from "./contribution-types.ts";

/**
 * Window relocate actions. Order: Move New → Copy New → Move Other → Copy Other
 * (destination-grouped; copy is files-only).
 */
export const PANEL_WINDOW_ACTION_CONTRIBUTIONS: readonly ActionContribution[] =
  [
    {
      categoryKey: "panel",
      group: "4_window",
      enabled: (invocation) => {
        const panelId = resolveRelocatePanelId(invocation?.sourcePanelId);
        return panelId != null && canMovePanelToWindow(panelId);
      },
      handler: async (invocation) => {
        const panelId = resolveRelocatePanelId(invocation?.sourcePanelId);
        if (!panelId) {
          return;
        }
        await movePanelToNewWindow(panelId);
      },
      iconComponent: AppWindow,
      id: "pier.panel.moveToNewWindow",
      menuHidden: (invocation) => {
        const panelId = resolveRelocatePanelId(invocation?.sourcePanelId);
        return panelId == null || !canMovePanelToWindow(panelId);
      },
      sortOrder: 1,
      surfaces: ["dockview-tab", "command-palette"],
      titleKey: "contextMenu.action.moveToNewWindow",
      when: "workspace.hasActivePanel",
    },
    {
      categoryKey: "panel",
      group: "4_window",
      enabled: (invocation) => {
        const panelId = resolveRelocatePanelId(invocation?.sourcePanelId);
        return panelId != null && canCopyPanelToWindow(panelId);
      },
      handler: async (invocation) => {
        const panelId = resolveRelocatePanelId(invocation?.sourcePanelId);
        if (!panelId) {
          return;
        }
        await copyPanelToNewWindow(panelId);
      },
      id: "pier.panel.copyToNewWindow",
      menuHidden: (invocation) => {
        const panelId = resolveRelocatePanelId(invocation?.sourcePanelId);
        return panelId == null || !canCopyPanelToWindow(panelId);
      },
      sortOrder: 2,
      surfaces: ["dockview-tab", "command-palette"],
      titleKey: "contextMenu.action.copyToNewWindow",
      when: "workspace.hasActivePanel",
    },
    {
      categoryKey: "panel",
      group: "4_window",
      enabled: (invocation) => {
        const panelId = resolveRelocatePanelId(invocation?.sourcePanelId);
        return panelId != null && canMovePanelToWindow(panelId);
      },
      handler: async (invocation) => {
        const panelId = resolveRelocatePanelId(invocation?.sourcePanelId);
        if (!panelId) {
          return;
        }
        await movePanelToOtherWindow(panelId);
      },
      id: "pier.panel.moveToWindow",
      menuHidden: (invocation) => {
        const panelId = resolveRelocatePanelId(invocation?.sourcePanelId);
        return panelId == null || !canMovePanelToWindow(panelId);
      },
      sortOrder: 3,
      surfaces: ["dockview-tab", "command-palette"],
      titleKey: "contextMenu.action.moveToWindow",
      when: "workspace.hasActivePanel",
    },
    {
      categoryKey: "panel",
      group: "4_window",
      enabled: (invocation) => {
        const panelId = resolveRelocatePanelId(invocation?.sourcePanelId);
        return panelId != null && canCopyPanelToWindow(panelId);
      },
      handler: async (invocation) => {
        const panelId = resolveRelocatePanelId(invocation?.sourcePanelId);
        if (!panelId) {
          return;
        }
        await copyPanelToOtherWindow(panelId);
      },
      id: "pier.panel.copyToWindow",
      menuHidden: (invocation) => {
        const panelId = resolveRelocatePanelId(invocation?.sourcePanelId);
        return panelId == null || !canCopyPanelToWindow(panelId);
      },
      sortOrder: 4,
      surfaces: ["dockview-tab", "command-palette"],
      titleKey: "contextMenu.action.copyToWindow",
      when: "workspace.hasActivePanel",
    },
  ];
