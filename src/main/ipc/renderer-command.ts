import type { RendererCommandResult } from "@shared/contracts/renderer-command.ts";
import { RENDERER_COMMAND_RESULT_CHANNEL } from "@shared/contracts/renderer-command-channels.ts";
import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";

export function registerRendererCommandIpc(ipcMain: IpcMain): void {
  ipcMain.on(
    RENDERER_COMMAND_RESULT_CHANNEL,
    (event, result: RendererCommandResult) => {
      appCore.services.rendererCommand.resolve(result, event.sender.id);
    }
  );
}
