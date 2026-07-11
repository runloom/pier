const BACKGROUND_PANEL_ID_PREFIX = "background-task:";

export function backgroundPanelId(runId: string, taskId: string): string {
  return `${BACKGROUND_PANEL_ID_PREFIX}${runId}:${taskId}`;
}

export function isBackgroundPanelId(panelId: string): boolean {
  return panelId.startsWith(BACKGROUND_PANEL_ID_PREFIX);
}

export function panelRefKey(
  panelId: string,
  windowId?: string | undefined
): string {
  return windowId ? `${windowId}\0${panelId}` : panelId;
}
