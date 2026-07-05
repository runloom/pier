const freshTerminalPanelIds = new Set<string>();

export function markFreshTerminalPanel(panelId: string): void {
  freshTerminalPanelIds.add(panelId);
}

export function clearFreshTerminalPanel(panelId: string): void {
  freshTerminalPanelIds.delete(panelId);
}

export function isFreshTerminalPanel(panelId: string): boolean {
  return freshTerminalPanelIds.has(panelId);
}

export function consumeFreshTerminalPanel(panelId: string): boolean {
  if (!freshTerminalPanelIds.has(panelId)) {
    return false;
  }
  freshTerminalPanelIds.delete(panelId);
  return true;
}

export function resetFreshTerminalPanelsForTests(): void {
  freshTerminalPanelIds.clear();
}
