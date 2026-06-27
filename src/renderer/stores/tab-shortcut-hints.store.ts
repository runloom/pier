import { create } from "zustand";

interface PanelLike {
  id: string;
}

interface TabShortcutHintsState {
  activeGroupTabHints: Record<string, number>;
  commandKeyDown: boolean;
  reset: () => void;
  setActiveGroupPanels: (panels: readonly PanelLike[]) => void;
  setCommandKeyDown: (commandKeyDown: boolean) => void;
}

function tabHintsForPanels(
  panels: readonly PanelLike[]
): Record<string, number> {
  return Object.fromEntries(
    panels.slice(0, 9).map((panel, index) => [panel.id, index + 1])
  );
}

export const useTabShortcutHintsStore = create<TabShortcutHintsState>(
  (set) => ({
    activeGroupTabHints: {},
    commandKeyDown: false,
    reset: () => set({ activeGroupTabHints: {}, commandKeyDown: false }),
    setActiveGroupPanels: (panels) =>
      set({ activeGroupTabHints: tabHintsForPanels(panels) }),
    setCommandKeyDown: (commandKeyDown) => set({ commandKeyDown }),
  })
);
