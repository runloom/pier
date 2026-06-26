import {
  DEFAULT_WINDOW_ZOOM_LEVEL,
  type ProjectPreferences,
} from "@shared/contracts/preferences.ts";
import { clampWindowZoomLevel } from "@shared/zoom.ts";
import { create } from "zustand";

interface ZoomSnapshot {
  windowZoomLevel: number;
}

interface ZoomState {
  _hydrate: (snapshot: ZoomSnapshot) => void;
  resetZoom: () => Promise<void>;
  setWindowZoomLevel: (next: number) => Promise<void>;
  windowZoomLevel: number;
  zoomIn: () => Promise<void>;
  zoomOut: () => Promise<void>;
}

function toZoomSnapshot(snapshot: Partial<ProjectPreferences>): ZoomSnapshot {
  return {
    windowZoomLevel: clampWindowZoomLevel(
      typeof snapshot.windowZoomLevel === "number"
        ? snapshot.windowZoomLevel
        : DEFAULT_WINDOW_ZOOM_LEVEL
    ),
  };
}

export const useZoomStore = create<ZoomState>((set) => ({
  windowZoomLevel: DEFAULT_WINDOW_ZOOM_LEVEL,

  _hydrate(snapshot) {
    const next = toZoomSnapshot(snapshot);
    set((state) =>
      state.windowZoomLevel === next.windowZoomLevel ? state : next
    );
  },

  async setWindowZoomLevel(next) {
    try {
      const merged = await window.pier.preferences.update({
        windowZoomLevel: clampWindowZoomLevel(next),
      });
      set(toZoomSnapshot(merged));
    } catch (err) {
      console.error("[zoom.store] setWindowZoomLevel IPC failed:", err);
    }
  },

  async zoomIn() {
    const current = useZoomStore.getState().windowZoomLevel;
    await useZoomStore.getState().setWindowZoomLevel(current + 1);
  },

  async zoomOut() {
    const current = useZoomStore.getState().windowZoomLevel;
    await useZoomStore.getState().setWindowZoomLevel(current - 1);
  },

  async resetZoom() {
    await useZoomStore.getState().setWindowZoomLevel(DEFAULT_WINDOW_ZOOM_LEVEL);
  },
}));

let preferencesListenerAttached = false;
let detachPreferencesListener: (() => void) | null = null;

function attachPreferencesListener(): void {
  if (preferencesListenerAttached || typeof window === "undefined") {
    return;
  }
  const detach = window.pier?.preferences?.onChanged?.((next) => {
    useZoomStore.getState()._hydrate(toZoomSnapshot(next));
  });
  if (!detach) {
    return;
  }
  detachPreferencesListener = detach;
  preferencesListenerAttached = true;
}

export function detachZoomListener(): void {
  detachPreferencesListener?.();
  detachPreferencesListener = null;
  preferencesListenerAttached = false;
}

export async function initZoom(): Promise<void> {
  attachPreferencesListener();
  try {
    const snapshot = await window.pier.preferences.read();
    useZoomStore.getState()._hydrate(toZoomSnapshot(snapshot));
  } catch (err) {
    console.error("[zoom.store] initZoom IPC failed; keeping default:", err);
  }
}
