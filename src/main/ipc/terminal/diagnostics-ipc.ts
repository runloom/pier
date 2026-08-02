import type { IpcMain } from "electron";
import { registerTerminalDebugSnapshotIpc } from "./debug-snapshot.ts";
import { registerTerminalInputRoutingDiagnosticsIpc } from "./input-routing-diagnostics.ts";
import type { NativeAddon } from "./native-addon.ts";

/** 终端调试快照与输入路由诊断 IPC 一并注册。 */
export function registerTerminalDiagnosticsIpc(
  ipcMain: IpcMain,
  addon: NativeAddon | null
): void {
  registerTerminalDebugSnapshotIpc(ipcMain, addon);
  registerTerminalInputRoutingDiagnosticsIpc(ipcMain);
}
