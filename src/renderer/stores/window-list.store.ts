import type { WindowInfo } from "@shared/contracts/events.ts";
import { create } from "zustand";

interface WindowListState {
  apply: (windows: readonly WindowInfo[]) => void;
  windows: readonly WindowInfo[];
}

export const useWindowListStore = create<WindowListState>((set) => ({
  windows: [],
  apply: (windows) => set({ windows: [...windows] }),
}));

/**
 * Map titles for FA / Index / collab, which key by Electron windowId.
 * Also index `WindowInfo.id` so allocator ids still resolve if a caller uses them.
 */
export function titleByWindowIdFrom(
  windows: readonly WindowInfo[]
): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const window of windows) {
    if (!window.title) {
      continue;
    }
    titles[window.id] = window.title;
    if (window.electronWindowId) {
      titles[window.electronWindowId] = window.title;
    }
  }
  return titles;
}
