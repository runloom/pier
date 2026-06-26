import type { IpcMain } from "electron";
import type { NativeAddon } from "./terminal-native-addon.ts";

function normalizeShortcutKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) {
    return [];
  }
  return keys.filter((key): key is string => typeof key === "string");
}

export function registerTerminalShortcutIpc(
  ipcMain: IpcMain,
  addon: NativeAddon | null
): void {
  ipcMain.on("pier:terminal:set-app-shortcut-keys", (_event, keys) => {
    try {
      addon?.setAppShortcutKeys(normalizeShortcutKeys(keys));
    } catch (err) {
      console.error("[pier-terminal-set-app-shortcut-keys] failed:", err);
    }
  });
}
