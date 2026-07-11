import { randomUUID } from "node:crypto";
import { PIER } from "@shared/ipc-channels.ts";
import { app, ipcMain } from "electron";
import type { AppWindow } from "./app-window.ts";

const RENDERER_BOOT_TIMEOUT_MS = 15_000;

export interface RendererShowGate {
  cancel(): void;
  retry(): void;
  setReadyTimeoutHandler(handler: () => void): void;
}

export function createRendererShowGate(input: {
  recordId: string;
  showInactive: boolean;
  window: AppWindow;
  windowId: string;
}): RendererShowGate {
  const { recordId, showInactive, window, windowId } = input;
  let bootChallenge: string | null = null;
  let bootTimer: ReturnType<typeof setTimeout> | null = null;
  let didShow = false;
  let onReadyTimeout: () => void = () => undefined;

  const trace = (event: string, extra: Record<string, unknown> = {}) => {
    if (process.env.PIER_STARTUP_TRACE !== "1") return;
    console.info("[window-startup]", { event, recordId, windowId, ...extra });
  };
  const clearListeners = () => {
    ipcMain.off(PIER.WINDOW_RENDERER_READY, handleRendererReady);
    window.webContents.off("did-start-navigation", handleNavigationStart);
    window.webContents.off("dom-ready", handleDomReady);
  };
  const cancel = () => {
    if (bootTimer) clearTimeout(bootTimer);
    bootChallenge = null;
    bootTimer = null;
    clearListeners();
  };
  const showOnce = () => {
    if (didShow) return;
    didShow = true;
    cancel();
    if (window.isDestroyed()) return;
    trace("show", { showMode: showInactive ? "inactive" : "active" });
    if (showInactive) window.host.showInactive();
    else {
      if (process.platform === "darwin") app.focus?.({ steal: true });
      window.host.show();
      window.focus();
      window.webContents.focus();
    }
  };
  function handleRendererReady(
    event: Electron.IpcMainEvent,
    challenge: unknown
  ): void {
    if (
      event.sender !== window.webContents ||
      typeof challenge !== "string" ||
      challenge !== bootChallenge
    ) {
      return;
    }
    trace("boot-ready");
    showOnce();
  }
  function handleDomReady(): void {
    bootChallenge = randomUUID();
    try {
      window.webContents.send(
        PIER.WINDOW_RENDERER_BOOT_CHALLENGE,
        bootChallenge
      );
    } catch (error) {
      console.error("[window-startup] boot challenge failed:", error);
      cancel();
      onReadyTimeout();
      return;
    }
    trace("boot-challenge");
  }
  function handleNavigationStart(
    _event: Electron.Event,
    _url: string,
    isInPlace: boolean,
    isMainFrame: boolean
  ): void {
    if (!isMainFrame || isInPlace) return;
    window.webContents.off("did-start-navigation", handleNavigationStart);
    bootChallenge = null;
    ipcMain.on(PIER.WINDOW_RENDERER_READY, handleRendererReady);
    window.webContents.once("dom-ready", handleDomReady);
    trace("retry-navigation-start");
  }
  const startBootDeadline = () => {
    bootTimer = setTimeout(() => {
      const payload = {
        recordId,
        showMode: showInactive ? "inactive" : "active",
        windowId,
      };
      console.error("[window-startup] renderer boot timed out", payload);
      trace("boot-timeout", payload);
      cancel();
      onReadyTimeout();
    }, RENDERER_BOOT_TIMEOUT_MS);
  };
  ipcMain.on(PIER.WINDOW_RENDERER_READY, handleRendererReady);
  window.webContents.once("dom-ready", handleDomReady);
  startBootDeadline();
  return {
    cancel,
    retry: () => {
      if (!didShow) {
        cancel();
        window.webContents.on("did-start-navigation", handleNavigationStart);
        startBootDeadline();
      }
      window.webContents.reload();
    },
    setReadyTimeoutHandler: (handler) => {
      onReadyTimeout = handler;
    },
  };
}
