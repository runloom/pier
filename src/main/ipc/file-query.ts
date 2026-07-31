/**
 * File path + content query IPC — mirrors `registerFileWatchIpc` capability pattern:
 * - `PIER.FILE_QUERY_START` / `PIER.FILE_QUERY_CANCEL` invoke handlers
 * - events delivered per sender via `webContents.send(PIER.FILE_QUERY_EVENT, …)`
 * - capability: `file:read`
 *
 * The `FileQueryService` owns session state and cancellation; this module is
 * the thin capability + validation + lifecycle seam between the renderer and
 * that service.
 *
 * Content mode: docs/superpowers/specs/2026-07-27-files-content-search-design.md
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type FileQueryEvent,
  type FileQueryStart,
  fileContentQueryStartSchema,
  filePathQueryCancelSchema,
  filePathQueryStartSchema,
} from "@shared/contracts/file/query.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { PIER } from "@shared/ipc-channels.ts";
import {
  app,
  type IpcMainInvokeEvent,
  ipcMain,
  type WebContents,
} from "electron";
import { appCore } from "../app-core/index.ts";
import { createRgContentSearchRunner } from "../services/file-query/content-search.ts";
import { resolveSearchRuntime } from "../services/file-query/search-runtime.ts";
import { createFileQueryService } from "../services/file-query/service.ts";
import { windowManager } from "../windows/manager.ts";

/**
 * Collect candidate roots that may own `resources/search/<arch>/rg`.
 *
 * electron-vite PierDev.app sets `process.resourcesPath` to the stub Electron
 * Resources folder (no vendored rg). Always also probe the monorepo
 * `resources/` via cwd / appPath so dev works without packaging rg into PierDev.
 */
function collectSearchRuntimeCandidates(): {
  projectRoots: string[];
  resourcesRoots: string[];
} {
  const projectRoots: string[] = [];
  const resourcesRoots: string[] = [];
  const push = (list: string[], value: string | undefined): void => {
    if (!value || list.includes(value)) return;
    list.push(value);
  };

  // Packaged / PierDev Electron resources (may be empty of search/ in dev).
  if (typeof process.resourcesPath === "string" && process.resourcesPath) {
    push(resourcesRoots, process.resourcesPath);
  }

  // Workspace roots that contain `resources/search/...`.
  push(projectRoots, process.cwd());
  try {
    const appPath = app.getAppPath();
    push(projectRoots, appPath);
    // appPath may be `…/out/main` or asar — walk a few parents for monorepo root.
    let cursor = appPath;
    for (let i = 0; i < 6; i += 1) {
      const parent = dirname(cursor);
      if (!parent || parent === cursor) break;
      cursor = parent;
      push(projectRoots, cursor);
      if (existsSync(join(cursor, "resources", "search"))) {
        break;
      }
    }
    push(resourcesRoots, join(appPath, "resources"));
  } catch {
    // app not ready — cwd still probed
  }

  return { projectRoots, resourcesRoots };
}

export function registerFileQueryIpc(): void {
  const service = createFileQueryService({
    listIgnored: (cwd) => appCore.services.git.listIgnored(cwd),
    contentSearch: createRgContentSearchRunner({
      resolveRuntime: () => {
        const { projectRoots, resourcesRoots } =
          collectSearchRuntimeCandidates();
        return resolveSearchRuntime({
          projectRoots,
          resourcesRoots,
        });
      },
    }),
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
    // queries. Renderer never observes a stray `batch` past reload/quit.
    wc.once("destroyed", () => {
      service.cancelAll(wc.id);
    });
    wc.on("did-navigate", () => {
      service.cancelAll(wc.id);
    });
  }

  function parseStartPayload(payload: unknown): FileQueryStart | null {
    if (!payload || typeof payload !== "object") return null;
    // Auto-generate queryId if omitted; the plugin facade returns queryId
    // synchronously, so a caller-supplied id is the norm and this is the
    // safety net (design §4.1).
    const record = payload as Record<string, unknown>;
    const candidate =
      typeof record.queryId === "string" && record.queryId.length > 0
        ? payload
        : { ...record, queryId: randomUUID() };

    if (record.mode === "content") {
      const parsed = fileContentQueryStartSchema.safeParse(candidate);
      return parsed.success ? parsed.data : null;
    }

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
