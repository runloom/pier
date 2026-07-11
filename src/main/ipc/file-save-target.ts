import { isAbsolute, join } from "node:path";
import {
  type FileSaveTargetRequest,
  fileSaveTargetRequestSchema,
  fileSaveTargetSchema,
} from "@shared/contracts/file-save-target.ts";
import { PIER } from "@shared/ipc-channels.ts";
import {
  dialog,
  type IpcMain,
  type SaveDialogOptions,
  type SaveDialogReturnValue,
} from "electron";
import { resolveFileSaveTargetForPath } from "../services/panel-context-resolver.ts";
import type { AppWindow } from "../windows/app-window.ts";
import { findWindowContext } from "../windows/window-identity.ts";
import { windowManager } from "../windows/window-manager.ts";

type ResolveSaveTarget = (
  path: string,
  context: FileSaveTargetRequest["context"]
) => Promise<unknown>;

export interface FileSaveTargetIpcDependencies {
  resolveSaveTarget?: ResolveSaveTarget;
  showSaveDialog?: (
    window: AppWindow,
    options: SaveDialogOptions
  ) => Promise<SaveDialogReturnValue>;
}

function assertLivePierWindow(sender: Electron.WebContents): AppWindow {
  const window = windowManager.fromWebContents(sender);
  if (
    !window ||
    window.webContents !== sender ||
    sender.isDestroyed() ||
    window.isDestroyed() ||
    !windowManager.findInternalIdByWindow(window) ||
    !findWindowContext(window)
  ) {
    throw new Error("save target requires a live Pier desktop window");
  }
  return window;
}

export function registerFileSaveTargetIpc(
  ipcMain: IpcMain,
  dependencies: FileSaveTargetIpcDependencies = {}
): void {
  const resolveSaveTarget =
    dependencies.resolveSaveTarget ?? resolveFileSaveTargetForPath;
  const showSaveDialog =
    dependencies.showSaveDialog ??
    ((window: AppWindow, options: SaveDialogOptions) =>
      dialog.showSaveDialog(window.host, options));

  ipcMain.handle(
    PIER.FILE_PICK_SAVE_TARGET,
    async (event, payload: unknown) => {
      const parsed = fileSaveTargetRequestSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("invalid file save target request");
      }
      if (!isAbsolute(parsed.data.context.projectRootPath)) {
        throw new Error("file save target context root must be absolute");
      }

      const sender = event.sender;
      const window = assertLivePierWindow(sender);
      const defaultPath = parsed.data.suggestedName
        ? join(parsed.data.context.projectRootPath, parsed.data.suggestedName)
        : parsed.data.context.projectRootPath;
      const result = await showSaveDialog(window, { defaultPath });

      // 对话框等待期间窗口可能已经被关闭；此时不得把选择结果交给旧 renderer。
      assertLivePierWindow(sender);
      if (result.canceled) {
        return null;
      }
      if (!result.filePath) {
        throw new Error("save dialog returned an empty target path");
      }

      const target = await resolveSaveTarget(
        result.filePath,
        parsed.data.context
      );
      return fileSaveTargetSchema.parse(target);
    }
  );
}
