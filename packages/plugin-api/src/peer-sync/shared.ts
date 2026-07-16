/**
 * Shared peer-tool helpers for official account plugins (Codex, Grok, …).
 * Renderer-safe: no Node builtins. Detection probes live in `./main`.
 */

export type PeerSyncTarget = "opencode" | "pi" | "omp";

export interface PeerAvailability {
  omp: boolean;
  opencode: boolean;
  pi: boolean;
}

const PEER_TARGETS = [
  "opencode",
  "pi",
  "omp",
] as const satisfies readonly PeerSyncTarget[];

export const ALL_PEER_SYNC_TARGETS: readonly PeerSyncTarget[] = PEER_TARGETS;

export function isPeerTargetAvailable(
  target: PeerSyncTarget,
  availability: PeerAvailability
): boolean {
  return availability[target];
}

/**
 * Split protocol-eligible targets into sync-ready vs not-installed.
 * Callers may further filter by protocol (e.g. Grok OIDC excludes Pi).
 */
export function partitionPeerTargets(
  protocolTargets: readonly PeerSyncTarget[],
  availability: PeerAvailability
): {
  available: PeerSyncTarget[];
  unavailable: PeerSyncTarget[];
} {
  const available: PeerSyncTarget[] = [];
  const unavailable: PeerSyncTarget[] = [];
  for (const target of protocolTargets) {
    if (isPeerTargetAvailable(target, availability)) {
      available.push(target);
    } else {
      unavailable.push(target);
    }
  }
  return { available, unavailable };
}
