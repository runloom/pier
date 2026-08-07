import {
  type RendererHangBreadcrumb,
  rendererHangBreadcrumbSchema,
  type StoredRendererHangBreadcrumb,
  sanitizeHangBreadcrumbFields,
} from "@shared/contracts/renderer-hang-breadcrumb.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import type { IpcMain } from "electron";
import { findAppWindowByWebContents } from "../windows/identity.ts";
import { rememberHangBreadcrumb } from "./renderer-hang-breadcrumb-store.ts";

export {
  __resetHangBreadcrumbsForTests,
  clearHangBreadcrumbsForWindow,
  getHangBreadcrumbsForDiagnostics,
  getHangBreadcrumbsForWindow,
  rememberHangBreadcrumb,
} from "./renderer-hang-breadcrumb-store.ts";

const log = createLogger("renderer.hang-breadcrumb");

const MAX_BATCH_ITEMS = 32;

/**
 * Parse one crumb or a batch item-by-item so a single invalid entry cannot
 * wipe a full flush of valid trail. Clamp path/detail before parse.
 */
export function normalizeHangBreadcrumbBatch(
  raw: unknown
): RendererHangBreadcrumb[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw.slice(0, MAX_BATCH_ITEMS)
    : [raw];
  const out: RendererHangBreadcrumb[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    // Pre-clamp known string fields so oversize path does not drop the crumb.
    const loose = item as RendererHangBreadcrumb;
    const clamped = sanitizeHangBreadcrumbFields(loose);
    const parsed = rendererHangBreadcrumbSchema.safeParse(clamped);
    if (parsed.success) {
      out.push(parsed.data);
    }
  }
  return out;
}

/**
 * Renderer hang trail: validate batch, ring-buffer, one JSONL line per flush.
 * Window identity is always taken from event.sender (never from payload).
 */
export function registerRendererHangBreadcrumbIpc(ipcMain: IpcMain): void {
  ipcMain.on(PIER.RENDERER_HANG_BREADCRUMB, (event, raw) => {
    const win = findAppWindowByWebContents(event.sender);
    if (!win) {
      return;
    }
    const crumbs = normalizeHangBreadcrumbBatch(raw);
    if (crumbs.length === 0) {
      log.warn("Dropped hang breadcrumb", {
        reason: "invalid-payload",
        senderId: event.sender.id,
      });
      return;
    }
    const receivedAt = Date.now();
    const stored: StoredRendererHangBreadcrumb[] = crumbs.map((crumb) => ({
      ...crumb,
      receivedAt,
    }));
    for (const crumb of stored) {
      rememberHangBreadcrumb(win.id, crumb);
    }
    // Single log line per flush keeps disk I/O low under continuous trail.
    log.info("renderer-hang-trail", {
      browserWindowId: win.id,
      count: stored.length,
      crumbs: stored,
    });
  });
}
