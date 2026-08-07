import { PIER } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import type { IpcMain } from "electron";
import { z } from "zod";
import { findAppWindowByWebContents } from "../windows/identity.ts";
import { windowManager } from "../windows/manager.ts";
import { registerRendererHangBreadcrumbIpc } from "./renderer-hang-breadcrumb.ts";
import { sanitizeTaskRuntimeDiagnosticCtx } from "./sanitize-task-runtime-diagnostic-ctx.ts";

const log = createLogger("task.runtime.renderer");

const payloadSchema = z
  .object({
    ctx: z.record(z.string(), z.unknown()).optional(),
    msg: z.string().min(1).max(200),
    scope: z.string().min(1).max(80),
  })
  .strict();

export { sanitizeTaskRuntimeDiagnosticCtx } from "./sanitize-task-runtime-diagnostic-ctx.ts";

/**
 * Renderer 任务诊断桥：写到与 main 相同的 diagnostics JSONL，
 * 避免只在 DevTools 可见、主进程终端无 renderer 日志。
 */
export function registerTaskRuntimeDiagnosticsIpc(ipcMain: IpcMain): void {
  ipcMain.on(PIER.TASK_RUNTIME_DIAGNOSTIC, (event, raw) => {
    const win = findAppWindowByWebContents(event.sender);
    if (!win) {
      return;
    }
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) {
      return;
    }
    const windowId = windowManager.findInternalIdByWindow(win);
    const ctx = sanitizeTaskRuntimeDiagnosticCtx(parsed.data.ctx);
    log.info(parsed.data.msg, {
      ...(ctx ?? {}),
      rendererScope: parsed.data.scope,
      windowId,
    });
  });
  // Hang trail shares the diagnostics JSONL path; keep registration next to
  // task runtime diagnostics so main/index stays under the file-size cap.
  registerRendererHangBreadcrumbIpc(ipcMain);
}
