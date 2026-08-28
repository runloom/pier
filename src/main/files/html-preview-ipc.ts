import {
  htmlPreviewTicketIssueRequestSchema,
  htmlPreviewTicketReleaseRequestSchema,
  htmlPreviewTicketTouchRequestSchema,
} from "@shared/contracts/file/html-preview-ticket.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { appCore } from "../app-core/index.ts";
import { isTrustedMainFrame } from "../ipc/trusted-main-frame.ts";
import {
  type ExistingFileIdentity,
  FilePathIdentityError,
  isMissingPathError,
  resolveExistingFileIdentity,
  unsupportedFileType,
} from "../services/files/path-identity.ts";
import { windowManager } from "../windows/manager.ts";
import {
  htmlPreviewPartitionKey,
  htmlPreviewTicketRegistry,
} from "./html-preview-ticket-registry.ts";

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

export function registerHtmlPreviewTicketIpc(): void {
  const hooked = new WeakSet<WebContents>();

  const hookLifecycle = (sender: WebContents) => {
    if (hooked.has(sender)) return;
    hooked.add(sender);
    const revoke = () => {
      htmlPreviewTicketRegistry.revokeWebContents(sender.id);
    };
    sender.once("destroyed", revoke);
    sender.on("did-navigate", revoke);
    sender.on("render-process-gone", revoke);
  };

  ipcMain.handle(
    PIER.HTML_PREVIEW_TICKET_ISSUE,
    async (event: IpcMainInvokeEvent, payload: unknown) => {
      const parsed = htmlPreviewTicketIssueRequestSchema.safeParse(payload);
      if (!parsed.success)
        return { issued: false, reason: "invalid-request" } as const;
      if (!(isTrustedMainFrame(event) && rendererCanReadFiles(event.sender)))
        return { issued: false, reason: "forbidden" } as const;
      hookLifecycle(event.sender);
      let identity: ExistingFileIdentity;
      try {
        identity = await resolveExistingFileIdentity(
          parsed.data.root,
          parsed.data.path
        );
      } catch (error) {
        if (error instanceof FilePathIdentityError)
          return { issued: false, reason: "outside-root" } as const;
        if (isMissingPathError(error))
          return { issued: false, reason: "not-found" } as const;
        return { issued: false, reason: "unavailable" } as const;
      }
      if (unsupportedFileType(identity.stat)) {
        return { issued: false, reason: "not-found" } as const;
      }
      const { ticket } = htmlPreviewTicketRegistry.issue({
        owner: {
          partition: htmlPreviewPartitionKey(event.sender.session),
          webContentsId: event.sender.id,
        },
        ...(parsed.data.previousTicket
          ? { previousTicket: parsed.data.previousTicket }
          : {}),
        rootRealpath: identity.realRoot,
      });
      return {
        issued: true,
        relPath: identity.canonicalPath,
        ticket,
      } as const;
    }
  );

  ipcMain.handle(
    PIER.HTML_PREVIEW_TICKET_RELEASE,
    async (event: IpcMainInvokeEvent, payload: unknown) => {
      const parsed = htmlPreviewTicketReleaseRequestSchema.safeParse(payload);
      if (!(parsed.success && isTrustedMainFrame(event))) return false;
      const owner = {
        partition: htmlPreviewPartitionKey(event.sender.session),
        webContentsId: event.sender.id,
      };
      if (!htmlPreviewTicketRegistry.authorize(parsed.data.ticket, owner))
        return false;
      return htmlPreviewTicketRegistry.release(parsed.data.ticket);
    }
  );

  ipcMain.handle(
    PIER.HTML_PREVIEW_TICKET_TOUCH,
    async (event: IpcMainInvokeEvent, payload: unknown) => {
      const parsed = htmlPreviewTicketTouchRequestSchema.safeParse(payload);
      if (
        !(
          parsed.success &&
          isTrustedMainFrame(event) &&
          rendererCanReadFiles(event.sender)
        )
      )
        return false;
      return htmlPreviewTicketRegistry.touch(parsed.data.ticket, {
        partition: htmlPreviewPartitionKey(event.sender.session),
        webContentsId: event.sender.id,
      });
    }
  );
}
