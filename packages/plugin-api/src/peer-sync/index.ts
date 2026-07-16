/**
 * Shared peer-tool helpers for official account plugins (Codex, Grok, …).
 * Renderer-safe entry. Node sync-ready probes: `@pier/plugin-api/peer-sync/main`.
 */

export {
  ALL_PEER_SYNC_TARGETS,
  isPeerTargetAvailable,
  type PeerAvailability,
  type PeerSyncTarget,
  partitionPeerTargets,
} from "./shared.ts";
