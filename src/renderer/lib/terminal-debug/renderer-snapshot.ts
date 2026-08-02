import type { TerminalDebugRendererSnapshot } from "@shared/contracts/terminal/debug.ts";
import { getLastTerminalHostSnapshot } from "@/lib/workspace/terminal-host-state-reconciler.ts";
import {
  hasRegisteredTerminalAnchor,
  readRegisteredTerminalAnchorFrame,
} from "@/panel-kits/terminal/layout-coordinator.ts";
import { readTerminalPanelLifecycleDebug } from "@/panel-kits/terminal/lifecycle-debug.ts";
import { readTerminalViewportFrame } from "@/panel-kits/terminal/viewport.ts";
import { getTerminalFocusRoutingDebugSnapshot } from "@/stores/terminal-input-routing-slice.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

export function buildRendererDebugSnapshot(): TerminalDebugRendererSnapshot {
  const focusRouting = getTerminalFocusRoutingDebugSnapshot();
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return {
      activePanelId: null,
      focusRouting,
      hasMaximizedGroup: false,
      panelCount: 0,
      panels: [],
    };
  }
  const activePanelId = api.activePanel?.id ?? null;
  return {
    activePanelId,
    desiredHostSnapshot: getLastTerminalHostSnapshot() ?? undefined,
    focusRouting,
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
      resourceMode: panel.api.isVisible ? "visible" : "warmHidden",
      terminalLifecycle: readTerminalPanelLifecycleDebug(panel.id),
    })),
    viewportFrame: readTerminalViewportFrame(),
  };
}
