import {
  DEFAULT_WINDOW_ZOOM_LEVEL,
  type ProjectPreferences,
} from "@shared/contracts/preferences.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { clampWindowZoomLevel } from "@shared/zoom.ts";
import type { WebContents } from "electron";

type ZoomPreferences = Pick<ProjectPreferences, "windowZoomLevel">;

export interface WindowZoomTarget {
  webContents: Pick<WebContents, "isDestroyed" | "send" | "setZoomLevel">;
}

export interface WindowZoomController {
  applyPersistedZoom(): Promise<void>;
  applyPersistedZoomToWindow(window: WindowZoomTarget): Promise<void>;
  applyZoomLevel(level: number): void;
  applyZoomLevelToWindow(window: WindowZoomTarget, level: number): void;
  resetZoom(): Promise<void>;
  zoomIn(): Promise<void>;
  zoomOut(): Promise<void>;
}

interface CreateWindowZoomControllerArgs {
  listWindows: () => readonly WindowZoomTarget[];
  readPreferences: () => Promise<ZoomPreferences>;
  updatePreferences: (
    patch: Pick<ProjectPreferences, "windowZoomLevel">
  ) => Promise<ZoomPreferences>;
}

export function createWindowZoomController({
  listWindows,
  readPreferences,
  updatePreferences,
}: CreateWindowZoomControllerArgs): WindowZoomController {
  const applyZoomLevelToWindow = (win: WindowZoomTarget, rawLevel: number) => {
    const level = clampWindowZoomLevel(rawLevel);
    if (win.webContents.isDestroyed()) {
      return;
    }
    win.webContents.setZoomLevel(level);
    win.webContents.send(PIER_BROADCAST.WINDOW_LAYOUT_PULSE, {
      reason: "view-zoom",
      windowZoomLevel: level,
    });
  };

  const applyZoomLevel = (rawLevel: number) => {
    for (const win of listWindows()) {
      applyZoomLevelToWindow(win, rawLevel);
    }
  };

  const persistZoomLevel = async (level: number) => {
    await updatePreferences({
      windowZoomLevel: clampWindowZoomLevel(level),
    });
  };

  return {
    async applyPersistedZoom() {
      const snapshot = await readPreferences();
      applyZoomLevel(snapshot.windowZoomLevel);
    },
    async applyPersistedZoomToWindow(window) {
      const snapshot = await readPreferences();
      applyZoomLevelToWindow(window, snapshot.windowZoomLevel);
    },
    applyZoomLevel,
    applyZoomLevelToWindow,
    async resetZoom() {
      await persistZoomLevel(DEFAULT_WINDOW_ZOOM_LEVEL);
    },
    async zoomIn() {
      const snapshot = await readPreferences();
      await persistZoomLevel(snapshot.windowZoomLevel + 1);
    },
    async zoomOut() {
      const snapshot = await readPreferences();
      await persistZoomLevel(snapshot.windowZoomLevel - 1);
    },
  };
}
