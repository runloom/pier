/**
 * Shared peer-tool helpers for official account plugins (Codex, Grok, …).
 * Renderer-safe: no Node builtins. Detection probes live in `./main`.
 *
 * fx is a peer sync target for Grok subscription credentials: fx reads the
 * same `~/.fx/grok-auth.json` session file when its provider is `grok`
 * (vercel-labs/fx `src/core/auth/grok_session.zig`, `src/core/shared/
 * profile_paths.zig`: `grok_auth_file_name = "grok-auth.json"`).
 */

export type PeerSyncTarget = "opencode" | "pi" | "omp" | "fx";

export interface PeerAvailability {
  /** Grok-subscription peer; absent in older snapshots — treat as unavailable. */
  fx?: boolean | undefined;
  omp: boolean;
  opencode: boolean;
  /**
   * Install-ready for credential materialization (agent dir or binary on PATH).
   * API-key sync can use this alone.
   */
  pi: boolean;
  /**
   * Pi can consume xAI OAuth / subscription login credentials (pi ≥ 0.80.8).
   * False when pi is missing, too old, or the version cannot be verified.
   * OIDC peers should treat pi as unavailable when this is false; API-key
   * sync must still key off `pi` only.
   */
  piOauthCapable: boolean;
}

const PEER_TARGETS = [
  "opencode",
  "pi",
  "omp",
  "fx",
] as const satisfies readonly PeerSyncTarget[];

export const ALL_PEER_SYNC_TARGETS: readonly PeerSyncTarget[] = PEER_TARGETS;

export function isPeerTargetAvailable(
  target: PeerSyncTarget,
  availability: PeerAvailability
): boolean {
  return availability[target] ?? false;
}

/**
 * Adjust install readiness for account credential kind.
 * OIDC / subscription login needs pi xAI OAuth; API keys only need install.
 * fx has no xAI API-key path (OIDC session only), so API-key sync hides fx.
 */
export function effectivePeerAvailabilityForKind(
  accountKind: "api_key" | "oidc",
  availability: PeerAvailability
): PeerAvailability {
  if (accountKind === "api_key") {
    return { ...availability, fx: false };
  }
  if (availability.piOauthCapable) {
    return availability;
  }
  return {
    ...availability,
    pi: false,
  };
}

/**
 * Split protocol-eligible targets into sync-ready vs not-installed.
 * Callers may further filter by protocol (e.g. Grok OIDC uses
 * `effectivePeerAvailabilityForKind` so pi requires `piOauthCapable`).
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
