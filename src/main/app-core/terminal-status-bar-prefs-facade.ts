import type {
  TerminalStatusBarItemOverridePatch,
  TerminalStatusBarOverridePatches,
  TerminalStatusBarPrefs,
} from "@shared/contracts/terminal/status-bar.ts";
import {
  applyTerminalStatusBarItemOverridePatch,
  applyTerminalStatusBarItemOverridePatches,
  readTerminalStatusBarPrefs,
  resetTerminalStatusBarItem,
} from "../state/terminal-status-bar-prefs.ts";
import { broadcastTerminalStatusBarPrefs } from "./window-broadcasts.ts";

/**
 * Command-router facade for terminal status-bar prefs (file-size split from
 * app-core/index.ts). Each mutation writes then broadcasts once.
 */
export function createTerminalStatusBarPrefsFacade(): {
  applyOverrides: (
    patches: TerminalStatusBarOverridePatches
  ) => Promise<TerminalStatusBarPrefs>;
  getAll: () => Promise<TerminalStatusBarPrefs>;
  resetItem: (itemId: string) => Promise<TerminalStatusBarPrefs>;
  setItemOverride: (
    itemId: string,
    patch: TerminalStatusBarItemOverridePatch
  ) => Promise<TerminalStatusBarPrefs>;
} {
  return {
    applyOverrides: async (patches) => {
      // F8: one mutate for all patches + a single broadcast (not N IPC).
      const next = await applyTerminalStatusBarItemOverridePatches(patches);
      broadcastTerminalStatusBarPrefs(next);
      return next;
    },
    getAll: () => readTerminalStatusBarPrefs(),
    resetItem: async (itemId) => {
      const next = await resetTerminalStatusBarItem(itemId);
      broadcastTerminalStatusBarPrefs(next);
      return next;
    },
    setItemOverride: async (itemId, patch) => {
      // F7: main-thread compose (patch → withItemOverridePatch); do not accept
      // a renderer-composed full override map (lost-update race).
      const next = await applyTerminalStatusBarItemOverridePatch(itemId, patch);
      broadcastTerminalStatusBarPrefs(next);
      return next;
    },
  };
}
