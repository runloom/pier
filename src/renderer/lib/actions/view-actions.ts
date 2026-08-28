import {
  dispatchPanelFind,
  type PanelFindAction,
} from "@plugins/api/panel-find.ts";
import i18next from "i18next";
import { PanelLeft, RotateCcw, Search, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import {
  dispatchTerminalOpenSearch,
  dispatchTerminalSearchNavigate,
} from "@/panel-kits/terminal/search-events.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

const FILES_FILE_PANEL_ID = "pier.files.filePanel";
const FILES_GROUP_VIEW_ID = "pier.files.groupView";
const FILES_SEARCH_PANEL_ID = "pier.files.searchPanel";
const GIT_CHANGES_PANEL_ID = "pier.git.changes";
const FILES_TREE_TOGGLE_COMMAND_ID = "pier.files.tree.toggle";
const GIT_REVIEW_TOGGLE_TREE_COMMAND_ID = "pier.git.review.toggleTree";

export type FindDispatchKind = "panel-find" | "terminal";

export function findDispatchKind(
  contentComponent: string | undefined
): FindDispatchKind | null {
  if (contentComponent === "terminal") {
    return "terminal";
  }
  if (
    contentComponent === FILES_FILE_PANEL_ID ||
    contentComponent === FILES_GROUP_VIEW_ID ||
    contentComponent === FILES_SEARCH_PANEL_ID ||
    contentComponent === GIT_CHANGES_PANEL_ID
  ) {
    return "panel-find";
  }
  return null;
}

function activeFindKind(): FindDispatchKind | null {
  return findDispatchKind(
    useWorkspaceStore.getState().api?.activePanel?.view.contentComponent
  );
}

function findEnabled(): boolean {
  return activeFindKind() !== null;
}

function findDisabledReason(): string {
  return i18next.t("commandPalette.action.findUnavailable");
}

function handleFindAction(action: PanelFindAction): void {
  const panel = useWorkspaceStore.getState().api?.activePanel;
  const panelId = panel?.id;
  const kind = findDispatchKind(panel?.view.contentComponent);
  if (!(panelId && kind)) {
    return;
  }
  if (kind === "terminal") {
    if (action === "open") {
      dispatchTerminalOpenSearch(panelId);
      return;
    }
    dispatchTerminalSearchNavigate(
      panelId,
      action === "next" ? "next" : "previous"
    );
    return;
  }
  dispatchPanelFind(panelId, action);
}

function handleToggleSideTree(): void | Promise<void> {
  const component =
    useWorkspaceStore.getState().api?.activePanel?.view.contentComponent;
  const commandId =
    component === GIT_CHANGES_PANEL_ID
      ? GIT_REVIEW_TOGGLE_TREE_COMMAND_ID
      : FILES_TREE_TOGGLE_COMMAND_ID;
  const action = actionRegistry.get(commandId);
  if (!action) {
    toast(i18next.t("commandPalette.action.toggleSideTreeUnavailable"));
    return;
  }
  return action.handler();
}

export const VIEW_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  {
    categoryKey: "view",
    disabledReason: findDisabledReason,
    enabled: findEnabled,
    group: "0_find",
    handler: () => handleFindAction("open"),
    iconComponent: Search,
    id: "pier.find",
    sortOrder: 0,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.find",
  },
  {
    categoryKey: "view",
    disabledReason: findDisabledReason,
    enabled: findEnabled,
    group: "0_find",
    handler: () => handleFindAction("next"),
    iconComponent: Search,
    id: "pier.findNext",
    sortOrder: 1,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.findNext",
  },
  {
    categoryKey: "view",
    disabledReason: findDisabledReason,
    enabled: findEnabled,
    group: "0_find",
    handler: () => handleFindAction("prev"),
    iconComponent: Search,
    id: "pier.findPrev",
    sortOrder: 2,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.findPrev",
  },
  {
    categoryKey: "view",
    group: "2_sidebar",
    handler: handleToggleSideTree,
    iconComponent: PanelLeft,
    id: "pier.view.toggleSideTree",
    sortOrder: 20,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.toggleSideTree",
  },
  {
    categoryKey: "view",
    group: "4_view",
    handler: () => useZoomStore.getState().zoomIn(),
    iconComponent: ZoomIn,
    id: "pier.view.zoomIn",
    sortOrder: 40,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.zoomIn",
  },
  {
    categoryKey: "view",
    group: "4_view",
    handler: () => useZoomStore.getState().zoomOut(),
    iconComponent: ZoomOut,
    id: "pier.view.zoomOut",
    sortOrder: 41,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.zoomOut",
  },
  {
    categoryKey: "view",
    group: "4_view",
    handler: () => useZoomStore.getState().resetZoom(),
    iconComponent: RotateCcw,
    id: "pier.view.resetZoom",
    sortOrder: 42,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.resetZoom",
  },
];

export function registerViewActions(): () => void {
  const disposers = registerActionContributions(
    VIEW_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
