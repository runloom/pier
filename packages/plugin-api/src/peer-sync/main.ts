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
  isPiOauthCapable,
  isPiSyncReady,
  isPiVersionAtLeast,
  type PeerAvailability,
  type PeerAvailabilityOptions,
  type PeerSyncTarget,
  PI_XAI_OAUTH_MIN_VERSION,
  parsePiVersion,
  partitionPeerTargets,
} from "./availability.ts";
export { effectivePeerAvailabilityForKind } from "./shared.ts";
