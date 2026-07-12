import type { PanelSlot } from "./entry.ts";

export function panelKey(windowId: string, panelId: string): string {
  return `${windowId}\0${panelId}`;
}

export function keysForPanel(
  slots: Map<string, PanelSlot>,
  panelId: string,
  windowId?: string
): string[] {
  if (windowId !== undefined) return [panelKey(windowId, panelId)];
  return [...slots.entries()]
    .filter(([, slot]) => slot.panelId === panelId)
    .map(([key]) => key);
}
