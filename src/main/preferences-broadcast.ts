import type { PreferenceChangedKey } from "@shared/contracts/events.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";

interface PreferencesBroadcastWindow {
  webContents: {
    isDestroyed(): boolean;
    send(channel: string, snapshot: ProjectPreferences): void;
  };
}

export function broadcastPreferencesChanged(
  windows: readonly PreferencesBroadcastWindow[],
  snapshot: ProjectPreferences
): void {
  for (const win of windows) {
    if (win.webContents.isDestroyed()) {
      continue;
    }
    win.webContents.send(PIER_BROADCAST.PREFERENCES_CHANGED, snapshot);
  }
}

export function handlePreferencesChangedForWindows({
  applyZoomLevel,
  changedKeys,
  listWindows,
  snapshot,
}: {
  applyZoomLevel(level: number): void;
  changedKeys: readonly PreferenceChangedKey[];
  listWindows(): readonly PreferencesBroadcastWindow[];
  snapshot: ProjectPreferences;
}): void {
  broadcastPreferencesChanged(listWindows(), snapshot);
  if (changedKeys.includes("windowZoomLevel")) {
    applyZoomLevel(snapshot.windowZoomLevel);
  }
}
