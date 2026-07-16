/**
 * Main-process peer-sync probes (Node builtins).
 * Renderer must import `@pier/plugin-api/peer-sync` instead.
 */

export {
  ALL_PEER_SYNC_TARGETS,
  detectPeerAvailability,
  isOmpSyncReady,
  isOpencodeSyncReady,
  isPeerTargetAvailable,
  isPiSyncReady,
  type PeerAvailability,
  type PeerAvailabilityOptions,
  type PeerSyncTarget,
  partitionPeerTargets,
} from "./availability.ts";
