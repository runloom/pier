import { randomBytes } from "node:crypto";
import {
  LIVE_MODULE_TICKET_PATTERN,
  liveModuleUrlForTicket,
} from "@shared/live-module-url.ts";

export interface LiveModuleArtifact {
  /** Asset tickets issued for this compile; revoked with the module. */
  assetTickets: string[];
  bytes: Buffer;
  graph: string[];
  moduleId: string;
  rootId: string;
  ticket: string;
}

export interface LiveAssetArtifact {
  bytes: Buffer;
  mimeType: string;
  ticket: string;
}

export interface LiveModuleTicketRegistry {
  get(ticket: string): LiveModuleArtifact | undefined;
  getAsset(ticket: string): LiveAssetArtifact | undefined;
  put(artifact: Omit<LiveModuleArtifact, "ticket">): LiveModuleArtifact;
  putAsset(artifact: LiveAssetArtifact): LiveAssetArtifact;
  revoke(ticket: string): void;
}

/** Opaque ticket matching `LIVE_MODULE_TICKET_PATTERN` (22–128 URL-safe chars). */
export function createLiveModuleTicket(
  isTaken: (ticket: string) => boolean = () => false
): string {
  let ticket = randomBytes(18).toString("base64url");
  while (!LIVE_MODULE_TICKET_PATTERN.test(ticket) || isTaken(ticket)) {
    ticket = randomBytes(18).toString("base64url");
  }
  return ticket;
}

/**
 * In-memory ticket → bytes registry. Protocol serve path reads only from here
 * (no disk cache dual-store — write-only cache was removed as redundant).
 */
export function createLiveModuleTicketRegistry(): LiveModuleTicketRegistry {
  const byTicket = new Map<string, LiveModuleArtifact>();
  const byAsset = new Map<string, LiveAssetArtifact>();

  function isTaken(ticket: string): boolean {
    return byTicket.has(ticket) || byAsset.has(ticket);
  }

  return {
    get(ticket) {
      return byTicket.get(ticket);
    },
    getAsset(ticket) {
      return byAsset.get(ticket);
    },
    put(artifact) {
      const ticket = createLiveModuleTicket(isTaken);
      const entry: LiveModuleArtifact = { ...artifact, ticket };
      byTicket.set(ticket, entry);
      return entry;
    },
    putAsset(artifact) {
      byAsset.set(artifact.ticket, artifact);
      return artifact;
    },
    revoke(ticket) {
      const module = byTicket.get(ticket);
      if (module) {
        for (const assetTicket of module.assetTickets) {
          byAsset.delete(assetTicket);
        }
        byTicket.delete(ticket);
        return;
      }
      byAsset.delete(ticket);
    },
  };
}

export function artifactUrl(artifact: LiveModuleArtifact): string {
  return liveModuleUrlForTicket(artifact.ticket);
}
