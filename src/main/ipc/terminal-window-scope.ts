import type { AppWindow } from "../windows/app-window.ts";
import { findInternalWindowId } from "../windows/window-identity.ts";

/** 窗口 → windowRecordId（持久化 key）。未注册时抛异常——不应走到。 */
export function windowRecordIdFor(win: AppWindow): string {
  const id = findInternalWindowId(win);
  if (id === null) {
    throw new Error("window not registered");
  }
  return id;
}

/** 调试日志用稳定窗口标识。未注册时抛异常。 */
export function stableWindowIdFor(win: AppWindow): string {
  const id = findInternalWindowId(win);
  if (id === null) {
    throw new Error("window not registered");
  }
  return id;
}
