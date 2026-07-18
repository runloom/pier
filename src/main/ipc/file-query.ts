/**
 * File path query IPC — mirrors `registerFileWatchIpc` capability pattern:
 * - `PIER.FILE_QUERY_START` / `PIER.FILE_QUERY_CANCEL` invoke handlers
 * - events delivered per sender via `webContents.send(PIER.FILE_QUERY_EVENT, …)`
 * - capability: `file:read`
 *
 * The `FileQueryService` (Task 2) owns session state and cancellation; this
 * module is the thin capability + validation + lifecycle seam between the
 * renderer and that service.
 */
import { randomUUID } from "node:crypto";
import {
  type FilePathQueryStart,
  type FileQueryEvent,
  filePathQueryCancelSchema,
  filePathQueryStartSchema,
} from "@shared/contracts/file-query.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { createFileQueryService } from "../services/file-query/file-query-service.ts";
import { windowManager } from "../windows/window-manager.ts";

export function registerFileQueryIpc(): void {
  const service = createFileQueryService({
    listIgnored: (cwd) => appCore.services.git.listIgnored(cwd),
  });
  const hookedWebContents = new WeakSet<WebContents>();

  function ensureClientHasFileRead(wc: WebContents): boolean {
    const window = windowManager.fromWebContents(wc);
    if (!window) return false;
    const windowId = windowManager.findInternalIdByWindow(window);
    if (!windowId) return false;
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
    if (hookedWebContents.has(wc)) return;
    hookedWebContents.add(wc);
    // Design §4.4: `webContents` destroyed / navigate → cancel this sender's
    // path queries. Renderer never observes a stray `batch` past reload/quit.
    wc.once("destroyed", () => {
      service.cancelAll(wc.id);
    });
    wc.on("did-navigate", () => {
      service.cancelAll(wc.id);
    });
  }

  function parseStartPayload(payload: unknown): FilePathQueryStart | null {
    if (!payload || typeof payload !== "object") return null;
    // Auto-generate queryId if omitted; the plugin facade returns queryId
    // synchronously, so a caller-supplied id is the norm and this is the
    // safety net (design §4.1).
    const record = payload as Record<string, unknown>;
    const candidate =
      typeof record.queryId === "string" && record.queryId.length > 0
        ? payload
        : { ...record, queryId: randomUUID() };
    const parsed = filePathQueryStartSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  ipcMain.handle(
    PIER.FILE_QUERY_START,
    (event: IpcMainInvokeEvent, payload: unknown) => {
      const request = parseStartPayload(payload);
      if (!request) return false;
      const wc = event.sender;
      if (!ensureClientHasFileRead(wc)) return false;
      hookLifecycleOnce(wc);
      service.start(wc.id, request, (fileQueryEvent: FileQueryEvent) => {
        if (wc.isDestroyed()) return;
        wc.send(PIER.FILE_QUERY_EVENT, fileQueryEvent);
      });
      return true;
    }
  );

  ipcMain.handle(
    PIER.FILE_QUERY_CANCEL,
    (event: IpcMainInvokeEvent, payload: unknown) => {
      const parsed = filePathQueryCancelSchema.safeParse(payload);
      if (!parsed.success) return false;
      service.cancel(event.sender.id, parsed.data.queryId);
      return true;
    }
  );
}
