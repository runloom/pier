import type { DockviewReadyEvent } from "dockview-react";
import {
  flushTerminalLayoutFramesTrailing,
  type TerminalLayoutFlushReason,
} from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import {
  type TerminalPresentationWorkspaceState,
  updateTerminalPresentationWorkspace,
} from "@/panel-kits/terminal/terminal-presentation-reconciler.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { panelKindOf } from "./panel-registry.ts";

function buildTerminalWorkspacePresentationState(
  api: DockviewReadyEvent["api"]
): TerminalPresentationWorkspaceState {
  const activePanel = api.activePanel;
  const activePanelKind = activePanel
    ? panelKindOf(activePanel.view.contentComponent)
    : "web";
  return {
    activePanelId: activePanel?.id ?? null,
    activeTerminalPanelId:
      activePanelKind === "terminal" ? (activePanel?.id ?? null) : null,
    hasMaximizedGroup: api.hasMaximizedGroup(),
    panels: api.panels.map((panel) => ({
      component: panel.view.contentComponent,
      dockviewActive: panel.api.isActive,
      dockviewVisible: panel.api.isVisible,
      id: panel.id,
    })),
  };
}

function reconcileTerminalPanels(api: DockviewReadyEvent["api"]): void {
  const terminalPanelIds = api.panels
    .filter((panel) => panel.view.contentComponent === "terminal")
    .map((panel) => panel.id);
  window.pier?.terminal?.reconcile?.(terminalPanelIds);
}

export function syncTerminalPresentation(
  api: DockviewReadyEvent["api"],
  flushReason: TerminalLayoutFlushReason
): void {
  useWorkspaceStore.getState().syncTabShortcutHints();
  updateTerminalPresentationWorkspace(
    buildTerminalWorkspacePresentationState(api),
    flushReason
  );
  flushTerminalLayoutFramesTrailing(flushReason);
  reconcileTerminalPanels(api);
}
