import type { TerminalDebugRendererSnapshot } from "@shared/contracts/terminal.ts";
import {
  hasRegisteredTerminalAnchor,
  readRegisteredTerminalAnchorFrame,
} from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import { readTerminalPanelLifecycleDebug } from "@/panel-kits/terminal/terminal-lifecycle-debug.ts";
import { getLastTerminalPresentationSnapshot } from "@/panel-kits/terminal/terminal-presentation-reconciler.ts";
import { readTerminalViewportFrame } from "@/panel-kits/terminal/terminal-viewport.ts";
import { usePanelResourceStore } from "@/stores/panel-resource.store.ts";
import { getLastTerminalInputRoutingSnapshot } from "@/stores/terminal-input-routing-slice.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

export function buildRendererDebugSnapshot(): TerminalDebugRendererSnapshot {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return {
      activePanelId: null,
      hasMaximizedGroup: false,
      panelCount: 0,
      panels: [],
    };
  }
  const activePanelId = api.activePanel?.id ?? null;
  const panelResources = usePanelResourceStore.getState().panels;
  return {
    activePanelId,
    desiredInputRouting: getLastTerminalInputRoutingSnapshot() ?? undefined,
    desiredPresentation: getLastTerminalPresentationSnapshot() ?? undefined,
    hasMaximizedGroup: api.hasMaximizedGroup(),
    panelCount: api.panels.length,
    panels: api.panels.map((panel) => ({
      anchorFrame: readRegisteredTerminalAnchorFrame(panel.id),
      component: panel.view.contentComponent,
      dockviewActive: panel.api.isActive,
      dockviewVisible: panel.api.isVisible,
      hasAnchor: hasRegisteredTerminalAnchor(panel.id),
      isActivePanel: panel.id === activePanelId,
      panelId: panel.id,
      resourceMode: panelResources[panel.id]?.mode,
      terminalLifecycle: readTerminalPanelLifecycleDebug(panel.id),
    })),
    viewportFrame: readTerminalViewportFrame(),
  };
}
