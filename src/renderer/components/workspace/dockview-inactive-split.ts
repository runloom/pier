import type { DockviewApi } from "dockview-react";

/**
 * `addPanel({ inactive: true })` sets both skipSetActive and skipSetGroupActive.
 * A new split group then has no active panel, so the pane stays blank (and
 * never creates a native PTY) until the user clicks it.
 *
 * Activate the panel inside its own group without activating the group, so
 * `focus: false` splits keep the leader focused.
 */
export function showInactiveSplitPanel(
  api: Pick<DockviewApi, "getPanel">,
  panelId: string
): void {
  if (typeof api.getPanel !== "function") {
    return;
  }
  const panel = api.getPanel(panelId);
  if (!panel) {
    return;
  }
  if (panel.group.activePanel) {
    return;
  }
  panel.group.model.openPanel(panel, { skipSetGroupActive: true });
}
