import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { windowManager } from "../windows/window-manager.ts";
import { createFileWatchSubscriptions } from "./file-watch-subscriptions.ts";

/**
 * file 变更监听 IPC（镜像 git-watch）:
 * - PIER.FILE_WATCH_START / STOP
 * - 事件经 PIER_BROADCAST.FILE_CHANGED 推回对应 BrowserWindow
 * - capability:`file:read`
 */
export function registerFileWatchIpc(): void {
  const subscriptions = createFileWatchSubscriptions();
  const hookedWebContents = new WeakSet<WebContents>();

  function ensureClientHasFileRead(wc: WebContents): boolean {
    const window = windowManager.fromWebContents(wc);
    if (!window) {
      return false;
    }
    const windowId = windowManager.findInternalIdByWindow(window);
    if (!windowId) {
      return false;
    }
    const clientId = `desktop-renderer:${windowId}`;
    let client = appCore.clients.heartbeat(clientId);
    if (!client) {
      const now = Date.now();
      appCore.clients.register({
        capabilities: DEFAULT_CAPABILITIES_BY_CLIENT_KIND["desktop-renderer"],
        createdAt: now,
        id: clientId,
        kind: "desktop-renderer",
        lastSeenAt: now,
      });
      client = appCore.clients.heartbeat(clientId);
    }
    return client?.capabilities.includes("file:read") === true;
  }

  function hookLifecycleOnce(wc: WebContents): void {
    if (hookedWebContents.has(wc)) {
      return;
    }
    hookedWebContents.add(wc);
    wc.once("destroyed", () => {
      subscriptions.dropAll(wc.id);
    });
    wc.on("did-navigate", () => {
      subscriptions.dropAll(wc.id);
    });
  }

  function parseStartPayload(
    payload: unknown
  ): { excludes: string[]; root: string } | null {
    if (typeof payload === "string") {
      return payload.length > 0 ? { excludes: [], root: payload } : null;
    }
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const record = payload as { excludes?: unknown; root?: unknown };
    if (typeof record.root !== "string" || record.root.length === 0) {
      return null;
    }
    const excludes = Array.isArray(record.excludes)
      ? record.excludes.filter(
          (candidate): candidate is string => typeof candidate === "string"
        )
      : [];
    return { excludes, root: record.root };
  }

  ipcMain.handle(
    PIER.FILE_WATCH_START,
    (event: IpcMainInvokeEvent, payload: unknown) => {
      const request = parseStartPayload(payload);
      if (!request) {
        return false;
      }
      const wc = event.sender;
      if (!ensureClientHasFileRead(wc)) {
        return false;
      }
      const service = appCore.services.fileWatch;
      if (!service) {
        return false;
      }
      const { excludes, root } = request;
      subscriptions.start(wc.id, root, () =>
        service.watch(
          root,
          (changeEvent) => {
            if (!wc.isDestroyed()) {
              wc.send(PIER_BROADCAST.FILE_CHANGED, changeEvent);
            }
          },
          excludes.length > 0 ? { excludes } : undefined
        )
      );
      hookLifecycleOnce(wc);
      return true;
    }
  );

  ipcMain.handle(
    PIER.FILE_WATCH_STOP,
    (event: IpcMainInvokeEvent, root: unknown) => {
      if (typeof root !== "string" || root.length === 0) {
        return false;
      }
      subscriptions.stop(event.sender.id, root);
      return true;
    }
  );
}
