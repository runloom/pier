import { createRequire } from "node:module";
import type {
  CreateTerminalArgs,
  TerminalFrame,
} from "@shared/contracts/terminal.ts";
import { BrowserWindow, type IpcMain } from "electron";

interface NativeAddon {
  closeTerminal(panelId: string): void;
  createTerminal(
    parentHandle: Buffer,
    panelId: string,
    frame: TerminalFrame
  ): boolean;
  focusTerminal(panelId: string): void;
  hideTerminal(panelId: string): void;
  setFrame(panelId: string, frame: TerminalFrame): void;
  setOverlayActive(active: boolean): void;
  setupWindow(parentHandle: Buffer): boolean;
  showTerminal(panelId: string): void;
}

function loadNativeAddon(): {
  addon: NativeAddon | null;
  error: string | null;
} {
  if (process.platform !== "darwin") {
    return { addon: null, error: "ghostty requires macOS" };
  }
  try {
    const require = createRequire(import.meta.url);
    const addon: NativeAddon = require("../../native/build/Release/ghostty_native.node");
    return { addon, error: null };
  } catch (e) {
    return {
      addon: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function registerTerminalIpc(ipcMain: IpcMain): void {
  const { addon, error: loadError } = loadNativeAddon();

  ipcMain.handle("pier:terminal:setup", (event) => {
    if (!addon) {
      return { ok: false, error: loadError ?? "native addon not loaded" };
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { ok: false, error: "window not found" };
    }
    try {
      const handle = win.getNativeWindowHandle();
      const ok = addon.setupWindow(handle);
      return ok ? { ok: true } : { ok: false, error: "setupWindow failed" };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("pier:terminal:create", (event, args: CreateTerminalArgs) => {
    if (!addon) {
      return { ok: false, error: loadError ?? "native addon not loaded" };
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { ok: false, error: "window not found" };
    }
    try {
      const handle = win.getNativeWindowHandle();
      const ok = addon.createTerminal(handle, args.panelId, args.frame);
      return ok
        ? { ok: true }
        : { ok: false, error: "createTerminal returned false" };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

  ipcMain.on(
    "pier:terminal:set-frame",
    (_event, panelId: string, frame: TerminalFrame) => {
      addon?.setFrame(panelId, frame);
    }
  );

  ipcMain.on("pier:terminal:show", (_event, panelId: string) => {
    addon?.showTerminal(panelId);
  });

  ipcMain.on("pier:terminal:hide", (_event, panelId: string) => {
    addon?.hideTerminal(panelId);
  });

  ipcMain.handle("pier:terminal:close", (_event, panelId: string) => {
    addon?.closeTerminal(panelId);
  });

  ipcMain.on("pier:terminal:focus", (_event, panelId: string) => {
    addon?.focusTerminal(panelId);
  });

  ipcMain.on("pier:terminal:set-overlay", (_event, active: boolean) => {
    addon?.setOverlayActive(active);
  });
}
