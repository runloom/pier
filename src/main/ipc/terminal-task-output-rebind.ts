import { taskOutputPanelParamsSchema } from "@shared/contracts/tasks.ts";
import type { IpcMain, WebContents } from "electron";
import type { AppWindow } from "../windows/app-window.ts";
import { findInternalWindowId } from "../windows/window-identity.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { toNativePanelKey } from "./terminal-panel-id.ts";
import type { TaskOutputTerminalBindings } from "./terminal-task-output-bindings.ts";

/** Renderer 只提交视图选择；main 在同一窗口作用域内完成 native adapter 重绑定。 */
export function registerTerminalTaskOutputRebindIpc(args: {
  addon: NativeAddon | null;
  ipcMain: IpcMain;
  taskOutputBindings: TaskOutputTerminalBindings | null;
  windowFromSender(sender: WebContents): AppWindow | null;
}): void {
  const { addon, ipcMain, taskOutputBindings, windowFromSender } = args;
  ipcMain.handle(
    "pier:terminal:rebind-task-output",
    (event, panelId: unknown, rawParams: unknown) => {
      const win = windowFromSender(event.sender);
      if (!(addon && taskOutputBindings && win)) {
        return { ok: false, error: "task output service is unavailable" };
      }
      if (typeof panelId !== "string" || panelId.length === 0) {
        return { ok: false, error: "invalid terminal panel id" };
      }
      const parsed = taskOutputPanelParamsSchema.safeParse(rawParams);
      if (!parsed.success) {
        return { ok: false, error: "invalid task output parameters" };
      }
      return taskOutputBindings.rebind({
        nativePanelId: toNativePanelKey(win, panelId),
        ownerWindowId: findInternalWindowId(win) ?? undefined,
        params: parsed.data,
      });
    }
  );
}
