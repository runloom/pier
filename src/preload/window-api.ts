import type { WindowInfo } from "@shared/contracts/events.ts";
import type { RendererRuntimeFailureReport } from "@shared/contracts/renderer-runtime-failure.ts";
import type {
  WindowContext,
  WindowFocusChangedPayload,
} from "@shared/contracts/window.ts";
import type { WindowLayoutPulse } from "@shared/contracts/window-layout.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";
import { subscribeIpc } from "./ipc-envelope.ts";

/** window 子命名空间 — 窗口生命周期与布局事件. */
export interface PierWindowNsAPI {
  closeCurrent: () => Promise<void>;
  getContext: () => Promise<WindowContext>;
  /** OS key-window focus for this BrowserWindow (not DOM hasFocus). */
  onFocusChanged: (
    cb: (payload: WindowFocusChangedPayload) => void
  ) => () => void;
  onLayoutPulse: (cb: (pulse: WindowLayoutPulse) => void) => () => void;
  onWindowsChanged: (cb: (windows: WindowInfo[]) => void) => () => void;
  readyToShow: () => void;
  /** Soft-reload current WebContents (error recovery). Prefer over app.relaunch. */
  reload: () => Promise<void>;
  reportRuntimeFailure: (failure: RendererRuntimeFailureReport) => void;
}

export function createWindowApi(readyToShow: () => void): PierWindowNsAPI {
  return {
    closeCurrent: () => ipcRenderer.invoke(PIER.WINDOW_CLOSE_CURRENT),
    getContext: () => ipcRenderer.invoke(PIER.WINDOW_CONTEXT),
    onFocusChanged: (cb) =>
      subscribeIpc(PIER_BROADCAST.WINDOW_FOCUS_CHANGED, cb),
    onLayoutPulse: (cb) => subscribeIpc(PIER_BROADCAST.WINDOW_LAYOUT_PULSE, cb),
    onWindowsChanged: (cb) => subscribeIpc(PIER_BROADCAST.WINDOW_CHANGED, cb),
    readyToShow,
    reload: () => ipcRenderer.invoke(PIER.WINDOW_RELOAD),
    reportRuntimeFailure: (failure) =>
      ipcRenderer.send(PIER.WINDOW_RENDERER_RUNTIME_FAILURE, failure),
  };
}
