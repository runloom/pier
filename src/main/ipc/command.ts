import { randomUUID } from "node:crypto";
import type { PierCommand } from "@shared/contracts/commands.ts";
import { pierCommandSchema } from "@shared/contracts/commands.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { PIER } from "@shared/ipc-channels.ts";
import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { windowManager } from "../windows/window-manager.ts";

function ensureDesktopRendererClient(windowId: string): string {
  const clientId = `desktop-renderer:${windowId}`;
  const existing = appCore.clients.heartbeat(clientId);
  if (existing) {
    return clientId;
  }
  const now = Date.now();
  appCore.clients.register({
    capabilities: DEFAULT_CAPABILITIES_BY_CLIENT_KIND["desktop-renderer"],
    createdAt: now,
    id: clientId,
    kind: "desktop-renderer",
    lastSeenAt: now,
  });
  return clientId;
}

function senderWindowId(sender: Electron.WebContents): string {
  const window = windowManager.fromWebContents(sender);
  if (!window) {
    throw new Error("window not found");
  }
  const windowId = windowManager.findInternalIdByWindow(window);
  if (!windowId) {
    throw new Error("window context not found");
  }
  return windowId;
}

function commandForSender(command: PierCommand, windowId: string): PierCommand {
  if (command.type === "run.spawn" && !command.windowId) {
    return {
      ...command,
      windowId,
    };
  }
  return command;
}

export function registerCommandIpc(ipcMain: IpcMain): void {
  ipcMain.handle(PIER.COMMAND_EXECUTE, async (event, rawCommand: unknown) => {
    const parsed = pierCommandSchema.safeParse(rawCommand);
    if (!parsed.success) {
      throw new Error("invalid command");
    }
    const command: PierCommand = parsed.data;
    const windowId = senderWindowId(event.sender);
    return await appCore.commandRouter.execute({
      clientId: ensureDesktopRendererClient(windowId),
      command: commandForSender(command, windowId),
      protocolVersion: 1,
      requestId: randomUUID(),
    });
  });
}
