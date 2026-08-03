import { terminalInputRoutingDiagnosticSchema } from "@shared/contracts/terminal/input-routing-diagnostics.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import type { IpcMain } from "electron";
import { findAppWindowByWebContents } from "../../windows/identity.ts";
import { stableWindowIdFor } from "./window-scope.ts";

const log = createLogger("terminal.input-routing");

/**
 * Renderer 只可提交字段白名单内的输入路由诊断。窗口身份、时间和日志等级由
 * main 控制，避免把 renderer 可控文本或跨窗口身份写进持久化日志。
 */
export function registerTerminalInputRoutingDiagnosticsIpc(
  ipcMain: IpcMain
): void {
  ipcMain.on(PIER.TERMINAL_INPUT_ROUTING_DIAGNOSTIC, (event, raw) => {
    const win = findAppWindowByWebContents(event.sender);
    if (!win) {
      log.warn("Dropped terminal input-routing diagnostic", {
        reason: "unknown-window",
        senderId: event.sender.id,
      });
      return;
    }
    const parsed = terminalInputRoutingDiagnosticSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn("Dropped terminal input-routing diagnostic", {
        reason: "invalid-payload",
        senderId: event.sender.id,
      });
      return;
    }
    let windowId: string;
    try {
      windowId = stableWindowIdFor(win);
    } catch {
      log.warn("Dropped terminal input-routing diagnostic", {
        reason: "unregistered-window",
        senderId: event.sender.id,
      });
      return;
    }
    const context = {
      ...parsed.data,
      browserWindowId: win.id,
      windowId,
    };
    if (
      parsed.data.action === "fallback-timeout" ||
      parsed.data.action === "owner-stuck"
    ) {
      log.warn("Terminal input-routing event", context);
      return;
    }
    log.info("Terminal input-routing event", context);
  });
}
