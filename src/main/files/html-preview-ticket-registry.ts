import { randomBytes } from "node:crypto";

const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_ENTRIES = 4096;
const DEFAULT_MAX_ENTRIES_PER_OWNER = 512;

export interface HtmlPreviewTicketOwner {
  partition: string;
  webContentsId: number;
}

interface StoredTicketEntry {
  expiresAt: number;
  owner: HtmlPreviewTicketOwner;
  ownerKey: string;
  rootRealpath: string;
  ticket: string;
}

export interface HtmlPreviewTicketRegistry {
  authorize(ticket: string, requester: HtmlPreviewTicketOwner): string | null;
  issue(input: {
    owner: HtmlPreviewTicketOwner;
    previousTicket?: string;
    rootRealpath: string;
  }): { expiresAt: number; ticket: string };
  peek(ticket: string): string | null;
  release(ticket: string): boolean;
  revokeWebContents(webContentsId: number): void;
  touch(ticket: string, requester: HtmlPreviewTicketOwner): boolean;
}

interface RegistryOptions {
  maxEntries?: number;
  maxEntriesPerOwner?: number;
  now(): number;
  randomToken(): string;
  ttlMs?: number;
}

function ownerKey(owner: HtmlPreviewTicketOwner): string {
  return `${owner.partition}${owner.webContentsId}`;
}

export function htmlPreviewPartitionKey(session: {
  storagePath?: string | null;
}): string {
  return session.storagePath ?? "in-memory";
}

export function createHtmlPreviewTicketRegistry(
  options: RegistryOptions
): HtmlPreviewTicketRegistry {
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
      owner: HtmlPreviewTicketOwner;
      previousTicket?: string;
      rootRealpath: string;
    }) {
      removeExpired();
      const key = ownerKey(input.owner);
      if (input.previousTicket) {
        const previous = entries.get(input.previousTicket);
        if (previous && previous.ownerKey === key) {
          entries.delete(input.previousTicket);
        }
      }
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
      entries.set(ticket, {
        expiresAt,
        owner: input.owner,
        ownerKey: key,
        rootRealpath: input.rootRealpath,
        ticket,
      });
      return { expiresAt, ticket };
    },

    authorize(
      ticket: string,
      requester: HtmlPreviewTicketOwner
    ): string | null {
      removeExpired();
      const entry = entries.get(ticket);
      if (
        !entry ||
        entry.owner.partition !== requester.partition ||
        entry.owner.webContentsId !== requester.webContentsId
      ) {
        return null;
      }
      entry.expiresAt = options.now() + ttlMs;
      entries.delete(ticket);
      entries.set(ticket, entry);
      return entry.rootRealpath;
    },
    peek(ticket: string): string | null {
      removeExpired();
      const entry = entries.get(ticket);
      if (!entry) {
        return null;
      }
      entry.expiresAt = options.now() + ttlMs;
      entries.delete(ticket);
      entries.set(ticket, entry);
      return entry.rootRealpath;
    },

    touch(ticket: string, requester: HtmlPreviewTicketOwner): boolean {
      return this.authorize(ticket, requester) !== null;
    },

    release(ticket: string): boolean {
      return entries.delete(ticket);
    },

    revokeWebContents(webContentsId: number): void {
      for (const [ticket, entry] of entries) {
        if (entry.owner.webContentsId === webContentsId) {
          entries.delete(ticket);
        }
      }
    },
  };
}

export const htmlPreviewTicketRegistry = createHtmlPreviewTicketRegistry({
  now: Date.now,
  randomToken: () => randomBytes(16).toString("base64url"),
});
