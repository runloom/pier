import { Plus, RotateCcw } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import { createWindow } from "@/lib/ipc/window-ipc.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { PANEL_LAYOUT_ACTION_CONTRIBUTIONS } from "./panel-layout-contributions.ts";

export const PANEL_HOST_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  {
    categoryKey: "panel",
    group: "1_new",
    handler: () => useWorkspaceStore.getState().addTab(),
    id: "pier.panel.newTab",
    surfaces: [],
    titleKey: "commandPalette.action.newTab",
    when: "workspace.hasApi",
  },
  {
    categoryKey: "run",
    group: "1_new",
    handler: () => {
      useWorkspaceStore.getState().addTerminal();
    },
    iconComponent: Plus,
    id: "pier.panel.newTerminal",
    sortOrder: 1,
    surfaces: ["dockview-tab", "terminal/content", "command-palette"],
    titleKey: "contextMenu.action.newTerminal",
    when: "workspace.hasApi",
  },
  {
    categoryKey: "window",
    group: "1_new",
    handler: () => {
      createWindow().catch((err) => {
        console.error("[actions] newWindow failed:", err);
      });
    },
    id: "pier.window.newWindow",
    surfaces: [],
    titleKey: "commandPalette.action.newWindow",
  },
  {
    categoryKey: "workspace",
    group: "z_workspace",
    handler: () => {
      useWorkspaceStore
        .getState()
        .resetLayout()
        .catch((err) => {
          console.error("[actions] resetLayout failed:", err);
        });
    },
    iconComponent: RotateCcw,
    id: "pier.workspace.resetLayout",
    sortOrder: 6,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.resetLayout",
    when: "workspace.hasApi",
  },
];

const TAB_FOCUS_INDICES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export const PANEL_TAB_FOCUS_ACTION_CONTRIBUTIONS: readonly ActionContribution[] =
  TAB_FOCUS_INDICES.map(
    (index): ActionContribution => ({
      categoryKey: "panel",
      group: "3_focus",
      handler: () => {
        useWorkspaceStore.getState().activateTabInActiveGroup(index - 1);
      },
      id: `pier.panel.focusTab${index}`,
      sortOrder: 10 + index,
      surfaces: [],
      titleKey: "commandPalette.action.focusTab",
      titleParams: { index },
      when: "workspace.hasApi",
    })
  );

export const PANEL_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  ...PANEL_LAYOUT_ACTION_CONTRIBUTIONS,
  ...PANEL_HOST_ACTION_CONTRIBUTIONS,
  ...PANEL_TAB_FOCUS_ACTION_CONTRIBUTIONS,
];

export function registerPanelActions(): () => void {
  const disposers = registerActionContributions(
    PANEL_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
