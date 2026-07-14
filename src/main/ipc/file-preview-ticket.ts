import { randomBytes } from "node:crypto";
import {
  filePreviewRuntimeAcquireRequestSchema,
  filePreviewRuntimeRevokeRequestSchema,
  filePreviewTicketIssueRequestSchema,
  filePreviewTicketReleaseRequestSchema,
} from "@shared/contracts/file-preview-ticket.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { appCore } from "../app-core/app-core.ts";
import {
  type FilePreviewTicketOwner,
  filePreviewPartitionKey,
  filePreviewTicketRegistry,
} from "../files/file-preview-ticket-registry.ts";
import { windowManager } from "../windows/window-manager.ts";

interface RuntimeLease {
  leaseId: string;
  owner: FilePreviewTicketOwner;
}

function rendererCanReadFiles(sender: WebContents): boolean {
  const window = windowManager.fromWebContents(sender);
  const windowId = window && windowManager.findInternalIdByWindow(window);
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

function isMainFrame(event: IpcMainInvokeEvent): boolean {
  return (
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame
  );
}

function randomToken(): string {
  return randomBytes(16).toString("base64url");
}

export function registerFilePreviewTicketIpc(): void {
  const leases = new Map<string, RuntimeLease>();
  const leaseByRecord = new Map<string, string>();
  const lifecycleGeneration = new WeakMap<WebContents, number>();
  const hooked = new WeakSet<WebContents>();

  const revokeLease = (leaseId: string): boolean => {
    const lease = leases.get(leaseId);
    if (!lease) return false;
    leases.delete(leaseId);
    leaseByRecord.delete(
      `${lease.owner.webContentsId}\0${lease.owner.recordId}`
    );
    filePreviewTicketRegistry.revokeRuntime(lease.owner.runtimeId);
    return true;
  };

  const revokeWebContents = (sender: WebContents) => {
    for (const [leaseId, lease] of leases) {
      if (lease.owner.webContentsId === sender.id) revokeLease(leaseId);
    }
    filePreviewTicketRegistry.revokeWebContents(sender.id);
  };

  const hookLifecycle = (sender: WebContents) => {
    if (hooked.has(sender)) return;
    hooked.add(sender);
    lifecycleGeneration.set(sender, 0);
    const revoke = () => {
      lifecycleGeneration.set(
        sender,
        (lifecycleGeneration.get(sender) ?? 0) + 1
      );
      revokeWebContents(sender);
    };
    sender.once("destroyed", revoke);
    sender.on("did-navigate", revoke);
    sender.on("render-process-gone", revoke);
  };

  const senderIsLive = (sender: WebContents, generation: number) =>
    !sender.isDestroyed() && lifecycleGeneration.get(sender) === generation;

  const liveLease = async (event: IpcMainInvokeEvent, leaseId: string) => {
    if (!(isMainFrame(event) && rendererCanReadFiles(event.sender)))
      return null;
    const lease = leases.get(leaseId);
    if (!lease || lease.owner.webContentsId !== event.sender.id) return null;
    const generation = lifecycleGeneration.get(event.sender) ?? -1;
    const entry = await appCore.services.plugins.inspect(lease.owner.recordId);
    if (
      leases.get(leaseId) !== lease ||
      !senderIsLive(event.sender, generation) ||
      !isMainFrame(event) ||
      !(entry?.enabled && entry.effectivePermissions.includes("file:read"))
    ) {
      revokeLease(leaseId);
      return null;
    }
    return lease;
  };

  ipcMain.handle(
    PIER.FILE_PREVIEW_RUNTIME_ACQUIRE,
    async (event: IpcMainInvokeEvent, payload: unknown) => {
      const parsed = filePreviewRuntimeAcquireRequestSchema.safeParse(payload);
      if (!parsed.success)
        return { acquired: false, reason: "invalid-request" } as const;
      if (!(isMainFrame(event) && rendererCanReadFiles(event.sender)))
        return { acquired: false, reason: "forbidden" } as const;
      hookLifecycle(event.sender);
      const generation = lifecycleGeneration.get(event.sender) ?? -1;
      const entry = await appCore.services.plugins.inspect(
        parsed.data.recordId
      );
      if (
        !(
          senderIsLive(event.sender, generation) &&
          isMainFrame(event) &&
          entry?.enabled &&
          entry.effectivePermissions.includes("file:read")
        )
      )
        return { acquired: false, reason: "forbidden" } as const;
      const recordKey = `${event.sender.id}\0${entry.manifest.id}`;
      const previousLease = leaseByRecord.get(recordKey);
      if (previousLease) revokeLease(previousLease);
      const leaseId = randomToken();
      const runtimeId = randomToken();
      leases.set(leaseId, {
        leaseId,
        owner: {
          partition: filePreviewPartitionKey(event.sender.session),
          recordId: entry.manifest.id,
          runtimeId,
          webContentsId: event.sender.id,
        },
      });
      leaseByRecord.set(recordKey, leaseId);
      return { acquired: true, leaseId, runtimeId } as const;
    }
  );

  ipcMain.handle(
    PIER.FILE_PREVIEW_TICKET_ISSUE,
    async (event: IpcMainInvokeEvent, payload: unknown) => {
      const parsed = filePreviewTicketIssueRequestSchema.safeParse(payload);
      if (!parsed.success)
        return { issued: false, reason: "invalid-request" } as const;
      const lease = await liveLease(event, parsed.data.leaseId);
      if (!lease) return { issued: false, reason: "forbidden" } as const;
      if (
        parsed.data.previousTicket &&
        filePreviewTicketRegistry.resolve(
          parsed.data.previousTicket,
          lease.owner
        )
      )
        filePreviewTicketRegistry.release(parsed.data.previousTicket);
      return {
        issued: true,
        ...filePreviewTicketRegistry.issue({
          locator: parsed.data.locator,
          owner: lease.owner,
        }),
      } as const;
    }
  );

  ipcMain.handle(
    PIER.FILE_PREVIEW_TICKET_RELEASE,
    async (event: IpcMainInvokeEvent, payload: unknown) => {
      const parsed = filePreviewTicketReleaseRequestSchema.safeParse(payload);
      if (!parsed.success) return false;
      const lease = await liveLease(event, parsed.data.leaseId);
      if (
        !(
          lease &&
          filePreviewTicketRegistry.resolve(parsed.data.ticket, lease.owner)
        )
      )
        return false;
      return filePreviewTicketRegistry.release(parsed.data.ticket);
    }
  );

  ipcMain.handle(
    PIER.FILE_PREVIEW_RUNTIME_REVOKE,
    (event: IpcMainInvokeEvent, payload: unknown) => {
      const parsed = filePreviewRuntimeRevokeRequestSchema.safeParse(payload);
      if (!(parsed.success && isMainFrame(event))) return false;
      const lease = leases.get(parsed.data.leaseId);
      return lease?.owner.webContentsId === event.sender.id
        ? revokeLease(parsed.data.leaseId)
        : false;
    }
  );
}
