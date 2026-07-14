import { randomBytes } from "node:crypto";
import type { FilePreviewTicketLocator } from "@shared/contracts/file-preview-ticket.ts";
import { filePreviewUrlForTicket } from "@shared/file-preview-url.ts";

const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_ENTRIES = 4096;
const DEFAULT_MAX_ENTRIES_PER_OWNER = 512;

export interface FilePreviewTicketOwner {
  partition: string;
  recordId: string;
  runtimeId: string;
  webContentsId: number;
}

export type { FilePreviewTicketLocator } from "@shared/contracts/file-preview-ticket.ts";

export interface FilePreviewTicketEntry {
  expiresAt: number;
  locator: FilePreviewTicketLocator;
  owner: FilePreviewTicketOwner;
  ticket: string;
}

interface StoredTicketEntry extends FilePreviewTicketEntry {
  ownerKey: string;
}

export interface FilePreviewTicketRegistry {
  issue(input: {
    locator: FilePreviewTicketLocator;
    owner: FilePreviewTicketOwner;
  }): { expiresAt: number; ticket: string; url: string };
  peek(ticket: string): FilePreviewTicketEntry | null;
  release(ticket: string): boolean;
  resolve(
    ticket: string,
    owner: FilePreviewTicketOwner
  ): FilePreviewTicketEntry | null;
  resolveRequest(
    ticket: string,
    requester: { partition: string; webContentsId: number }
  ): FilePreviewTicketEntry | null;
  revokeRuntime(runtimeId: string): void;
  revokeWebContents(webContentsId: number): void;
}

interface RegistryOptions {
  maxEntries?: number;
  maxEntriesPerOwner?: number;
  now(): number;
  randomToken(): string;
  ttlMs?: number;
}

function ownerKey(owner: FilePreviewTicketOwner): string {
  return `${owner.partition}\0${owner.webContentsId}\0${owner.recordId}\0${owner.runtimeId}`;
}

export function filePreviewPartitionKey(session: {
  storagePath?: string | null;
}): string {
  return session.storagePath ?? "in-memory";
}

export function createFilePreviewTicketRegistry(
  options: RegistryOptions
): FilePreviewTicketRegistry {
  const entries = new Map<string, StoredTicketEntry>();
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxEntriesPerOwner =
    options.maxEntriesPerOwner ?? DEFAULT_MAX_ENTRIES_PER_OWNER;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  const removeExpired = () => {
    const now = options.now();
    for (const [ticket, entry] of entries) {
      if (entry.expiresAt <= now) {
        entries.delete(ticket);
      }
    }
  };

  const evictOldestForOwner = (key: string) => {
    let count = 0;
    for (const entry of entries.values()) {
      if (entry.ownerKey === key) {
        count += 1;
      }
    }
    while (count >= maxEntriesPerOwner) {
      const oldest = [...entries.values()].find(
        (entry) => entry.ownerKey === key
      );
      if (!oldest) {
        break;
      }
      entries.delete(oldest.ticket);
      count -= 1;
    }
  };

  return {
    issue(input: {
      locator: FilePreviewTicketLocator;
      owner: FilePreviewTicketOwner;
    }) {
      removeExpired();
      const key = ownerKey(input.owner);
      evictOldestForOwner(key);
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        entries.delete(oldest);
      }
      let ticket = options.randomToken();
      while (entries.has(ticket)) {
        ticket = options.randomToken();
      }
      const expiresAt = options.now() + ttlMs;
      const entry: StoredTicketEntry = {
        expiresAt,
        locator: input.locator,
        owner: input.owner,
        ownerKey: key,
        ticket,
      };
      entries.set(ticket, entry);
      return { expiresAt, ticket, url: filePreviewUrlForTicket(ticket) };
    },

    peek(ticket: string): FilePreviewTicketEntry | null {
      removeExpired();
      return entries.get(ticket) ?? null;
    },

    resolveRequest(
      ticket: string,
      requester: { partition: string; webContentsId: number }
    ): FilePreviewTicketEntry | null {
      removeExpired();
      const entry = entries.get(ticket);
      if (
        !entry ||
        entry.owner.partition !== requester.partition ||
        entry.owner.webContentsId !== requester.webContentsId
      ) {
        return null;
      }
      entries.delete(ticket);
      entries.set(ticket, entry);
      return entry;
    },

    revokeWebContents(webContentsId: number): void {
      for (const [ticket, entry] of entries) {
        if (entry.owner.webContentsId === webContentsId) {
          entries.delete(ticket);
        }
      }
    },

    release(ticket: string): boolean {
      return entries.delete(ticket);
    },

    resolve(
      ticket: string,
      owner: FilePreviewTicketOwner
    ): FilePreviewTicketEntry | null {
      removeExpired();
      const entry = entries.get(ticket);
      if (!entry || entry.ownerKey !== ownerKey(owner)) {
        return null;
      }
      entries.delete(ticket);
      entries.set(ticket, entry);
      return entry;
    },

    revokeRuntime(runtimeId: string): void {
      for (const [ticket, entry] of entries) {
        if (entry.owner.runtimeId === runtimeId) {
          entries.delete(ticket);
        }
      }
    },
  };
}

export const filePreviewTicketRegistry = createFilePreviewTicketRegistry({
  now: Date.now,
  randomToken: () => randomBytes(16).toString("base64url"),
});
