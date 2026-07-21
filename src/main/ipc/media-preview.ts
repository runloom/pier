import { randomBytes } from "node:crypto";
import {
  type FilePreviewTicketIssueResult,
  mediaPreviewAbsoluteIssueRequestSchema,
  mediaPreviewAbsoluteReleaseRequestSchema,
} from "@shared/contracts/file-preview-ticket.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { resolveAbsoluteImagePreview } from "../files/absolute-image-preview.ts";
import {
  type FilePreviewTicketOwner,
  filePreviewPartitionKey,
  filePreviewTicketRegistry,
} from "../files/file-preview-ticket-registry.ts";
import { windowManager } from "../windows/window-manager.ts";
import { isTrustedMainFrame } from "./trusted-main-frame.ts";

const HOST_MEDIA_PREVIEW_RECORD_ID = "host:media-preview";

interface HostLease {
  leaseId: string;
  owner: FilePreviewTicketOwner;
}

function rendererCanReadFiles(sender: WebContents): boolean {
  const window = windowManager.fromWebContents(sender);
  const windowId = window && windowManager.findInternalIdByWindow(window);
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

function randomToken(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Host-owned absolute-path image preview tickets.
 * Reuses pier-file-preview protocol + registry; no plugin lease required.
 */
export function registerMediaPreviewIpc(): void {
  const leasesByWebContents = new Map<number, HostLease>();
  const hooked = new WeakSet<WebContents>();

  const revokeForSender = (sender: WebContents) => {
    const lease = leasesByWebContents.get(sender.id);
    if (!lease) {
      return;
    }
    leasesByWebContents.delete(sender.id);
    filePreviewTicketRegistry.revokeRuntime(lease.owner.runtimeId);
  };

  const hookLifecycle = (sender: WebContents) => {
    if (hooked.has(sender)) {
      return;
    }
    hooked.add(sender);
    const revoke = () => {
      revokeForSender(sender);
    };
    sender.once("destroyed", revoke);
    sender.once("did-navigate", revoke);
    sender.once("render-process-gone", revoke);
  };

  const ensureLease = (event: IpcMainInvokeEvent): HostLease | null => {
    const sender = event.sender;
    if (!(isTrustedMainFrame(event) && rendererCanReadFiles(sender))) {
      return null;
    }
    hookLifecycle(sender);
    const existing = leasesByWebContents.get(sender.id);
    if (existing) {
      return existing;
    }
    const leaseId = randomToken();
    const runtimeId = randomToken();
    const lease: HostLease = {
      leaseId,
      owner: {
        partition: filePreviewPartitionKey(sender.session),
        recordId: HOST_MEDIA_PREVIEW_RECORD_ID,
        runtimeId,
        webContentsId: sender.id,
      },
    };
    leasesByWebContents.set(sender.id, lease);
    return lease;
  };

  ipcMain.handle(
    PIER.MEDIA_PREVIEW_ABSOLUTE_ISSUE,
    async (
      event: IpcMainInvokeEvent,
      payload: unknown
    ): Promise<FilePreviewTicketIssueResult> => {
      const parsed = mediaPreviewAbsoluteIssueRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return { issued: false, reason: "invalid-request" };
      }
      const lease = ensureLease(event);
      if (!lease) {
        return { issued: false, reason: "forbidden" };
      }
      const resolved = await resolveAbsoluteImagePreview(
        parsed.data.absolutePath
      );
      if (!resolved.ok) {
        return { issued: false, reason: resolved.reason };
      }
      if (
        parsed.data.previousTicket &&
        filePreviewTicketRegistry.resolve(
          parsed.data.previousTicket,
          lease.owner
        )
      ) {
        filePreviewTicketRegistry.release(parsed.data.previousTicket);
      }
      return {
        issued: true,
        ...filePreviewTicketRegistry.issue({
          locator: resolved.locator,
          owner: lease.owner,
        }),
      };
    }
  );

  ipcMain.handle(
    PIER.MEDIA_PREVIEW_ABSOLUTE_RELEASE,
    async (event: IpcMainInvokeEvent, payload: unknown): Promise<boolean> => {
      const parsed =
        mediaPreviewAbsoluteReleaseRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return false;
      }
      const lease = leasesByWebContents.get(event.sender.id);
      if (!lease) {
        return false;
      }
      if (!filePreviewTicketRegistry.resolve(parsed.data.ticket, lease.owner)) {
        return false;
      }
      return filePreviewTicketRegistry.release(parsed.data.ticket);
    }
  );
}
