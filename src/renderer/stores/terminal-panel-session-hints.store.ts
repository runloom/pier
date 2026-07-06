const freshTerminalPanelIds = new Set<string>();
const freshTerminalInitialInputs = new Map<string, string>();

export function markFreshTerminalPanel(panelId: string): void {
  freshTerminalPanelIds.add(panelId);
}

export function clearFreshTerminalPanel(panelId: string): void {
  freshTerminalPanelIds.delete(panelId);
  freshTerminalInitialInputs.delete(panelId);
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

export function setFreshTerminalInitialInput(
  panelId: string,
  initialInput: string
): void {
  freshTerminalInitialInputs.set(panelId, initialInput);
}

export function consumeFreshTerminalInitialInput(
  panelId: string
): string | undefined {
  const initialInput = freshTerminalInitialInputs.get(panelId);
  freshTerminalInitialInputs.delete(panelId);
  return initialInput;
}

export function resetFreshTerminalPanelsForTests(): void {
  freshTerminalPanelIds.clear();
  freshTerminalInitialInputs.clear();
}
