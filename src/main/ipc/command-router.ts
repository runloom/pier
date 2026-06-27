import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierClient,
} from "@shared/contracts/permissions.ts";
import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";

const DESKTOP_RENDERER_CLIENT_ID = "desktop-renderer";
const COMMAND_ROUTER_CHANNEL = "pier:command-router:execute";

function ensureDesktopRendererClient(): PierClient {
  const existing = appCore.clients.get(DESKTOP_RENDERER_CLIENT_ID);
  if (existing) {
    appCore.clients.heartbeat(existing.id);
    return existing;
  }
  const now = Date.now();
  return appCore.clients.register({
    capabilities: DEFAULT_CAPABILITIES_BY_CLIENT_KIND["desktop-renderer"],
    createdAt: now,
    id: DESKTOP_RENDERER_CLIENT_ID,
    kind: "desktop-renderer",
    lastSeenAt: now,
  });
}

export function registerCommandRouterIpc(ipcMain: IpcMain): void {
  ipcMain.handle(COMMAND_ROUTER_CHANNEL, (_event, command: unknown) => {
    const client = ensureDesktopRendererClient();
    return appCore.commandRouter.execute({
      clientId: client.id,
      command,
      protocolVersion: 1,
      requestId: crypto.randomUUID(),
    });
  });
}

export { COMMAND_ROUTER_CHANNEL };
