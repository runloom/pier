/**
 * Window IPC bridge — renderer 侧调用 window.pier 的类型化封装.
 *
 * 直接调用 preload 暴露的 window.pier.* API, 不经过 ipcRenderer.
 */

export type { PierWindowAPI, WindowInfo } from "../../../preload/index.ts";

import type {
  WindowContext,
  WindowCreateResult,
} from "@shared/contracts/window.ts";
import type { WindowInfo } from "../../../preload/index.ts";

export function createWindow(): Promise<WindowCreateResult> {
  return window.pier.createWindow();
}

export function getWindowContext(): Promise<WindowContext> {
  return window.pier.window.getContext();
}

export function listWindows(): Promise<WindowInfo[]> {
  return window.pier.listWindows();
}

export function focusWindow(windowId: string): Promise<void> {
  return window.pier.focusWindow(windowId);
}

export function closeWindow(windowId: string): Promise<void> {
  return window.pier.closeWindow(windowId);
}

/** 关闭调用方所在窗口 (无需传 windowId, main 侧用 sender 定位). */
export function closeCurrentWindow(): Promise<void> {
  return window.pier.window.closeCurrent();
}
