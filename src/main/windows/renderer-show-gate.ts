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
    ipcMain.off(PIER.WINDOW_RENDERER_BOOT_REQUEST, handleRendererBootRequest);
    ipcMain.off(PIER.WINDOW_RENDERER_READY, handleRendererReady);
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
    window.webContents.setBackgroundThrottling(true);
    window.host.setOpacity(1);
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
  function handleRendererBootRequest(event: Electron.IpcMainEvent): void {
    if (event.sender !== window.webContents || bootChallenge !== null) return;
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
  const arm = () => {
    bootChallenge = null;
    ipcMain.on(PIER.WINDOW_RENDERER_BOOT_REQUEST, handleRendererBootRequest);
    ipcMain.on(PIER.WINDOW_RENDERER_READY, handleRendererReady);
  };
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
  // renderer 首个可用界面挂载后主动请求 challenge。窗口可见性的依据是实际
  // UI 挂载，而不是 WebContentsView 初始 about:blank 与目标文档之间存在竞态的
  // dom-ready 事件。每次重试重新 arm，旧 challenge 无法通过新一轮校验。
  arm();
  startBootDeadline();
  return {
    cancel,
    retry: () => {
      if (!didShow) {
        cancel();
        arm();
        startBootDeadline();
      }
      window.webContents.reload();
    },
    setReadyTimeoutHandler: (handler) => {
      onReadyTimeout = handler;
    },
  };
}
