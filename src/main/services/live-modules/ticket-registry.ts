import { randomBytes } from "node:crypto";
import {
  LIVE_MODULE_TICKET_PATTERN,
  liveModuleUrlForTicket,
} from "@shared/live-module-url.ts";

export interface LiveModuleArtifact {
  bytes: Buffer;
  graph: string[];
  moduleId: string;
  rootId: string;
  ticket: string;
}

export interface LiveModuleTicketRegistry {
  get(ticket: string): LiveModuleArtifact | undefined;
  put(artifact: Omit<LiveModuleArtifact, "ticket">): LiveModuleArtifact;
  revoke(ticket: string): void;
}

/**
 * In-memory ticket → bytes registry. Protocol serve path reads only from here
 * (no disk cache dual-store — write-only cache was removed as redundant).
 */
export function createLiveModuleTicketRegistry(): LiveModuleTicketRegistry {
  const byTicket = new Map<string, LiveModuleArtifact>();

  return {
    get(ticket) {
      return byTicket.get(ticket);
    },
    put(artifact) {
      let ticket = randomBytes(18).toString("base64url");
      while (!LIVE_MODULE_TICKET_PATTERN.test(ticket) || byTicket.has(ticket)) {
        ticket = randomBytes(18).toString("base64url");
      }
      const entry: LiveModuleArtifact = { ...artifact, ticket };
      byTicket.set(ticket, entry);
      return entry;
    },
    revoke(ticket) {
      byTicket.delete(ticket);
    },
  };
}

export function artifactUrl(artifact: LiveModuleArtifact): string {
  return liveModuleUrlForTicket(artifact.ticket);
}
