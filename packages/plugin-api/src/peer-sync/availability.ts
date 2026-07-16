import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { PeerAvailability } from "./shared.ts";

export type { PeerAvailability, PeerSyncTarget } from "./shared.ts";
export {
  ALL_PEER_SYNC_TARGETS,
  isPeerTargetAvailable,
  partitionPeerTargets,
} from "./shared.ts";

export interface PeerAvailabilityOptions {
  /** Override home directory (tests). */
  homeDir?: string;
  /** Override OpenCode data dir (tests). Defaults to `~/.local/share/opencode`. */
  opencodeDataDir?: string;
  /** Override PATH for binary probes (tests). */
  pathEnv?: string;
}

function resolveHomeDir(opts: PeerAvailabilityOptions): string {
  return opts.homeDir ?? homedir();
}

function commandExistsOnPath(
  command: string,
  pathEnv: string | undefined
): boolean {
  const env = pathEnv ?? process.env.PATH ?? "";
  for (const dir of env.split(delimiter)) {
    if (dir.length > 0 && existsSync(join(dir, command))) {
      return true;
    }
  }
  return false;
}

function opencodeConfigCandidates(home: string): string[] {
  return [
    join(home, ".config", "opencode", "opencode.json"),
    join(home, ".opencode", "opencode.json"),
  ];
}

function opencodeAuthPath(opts: PeerAvailabilityOptions): string {
  const dataDir =
    opts.opencodeDataDir ??
    join(resolveHomeDir(opts), ".local", "share", "opencode");
  return join(dataDir, "auth.json");
}

function piHome(opts: PeerAvailabilityOptions): string {
  // Match account sync writers: credentials land under `~/.pi/agent`.
  return join(resolveHomeDir(opts), ".pi", "agent");
}

function ompDbPath(opts: PeerAvailabilityOptions): string {
  // Match account sync writers: OAuth upsert requires an existing agent.db.
  return join(resolveHomeDir(opts), ".omp", "agent", "agent.db");
}

/**
 * Sync-ready probe for OpenCode.
 *
 * Evidence: binary on PATH, known config path, data directory, or existing
 * auth.json. Unlike host hook detect (config-only), this also accepts a bare
 * CLI install so users can opt into first-time auth materialization.
 */
export function isOpencodeSyncReady(
  opts: PeerAvailabilityOptions = {}
): boolean {
  const home = resolveHomeDir(opts);
  if (commandExistsOnPath("opencode", opts.pathEnv)) {
    return true;
  }
  if (opencodeConfigCandidates(home).some((path) => existsSync(path))) {
    return true;
  }
  const authPath = opencodeAuthPath(opts);
  return existsSync(authPath) || existsSync(dirname(authPath));
}

/**
 * Sync-ready probe for Pi.
 *
 * Evidence: `~/.pi/agent` exists or `pi` is on PATH. Matches the auth.json
 * location written by Codex / Grok peer sync.
 */
export function isPiSyncReady(opts: PeerAvailabilityOptions = {}): boolean {
  return existsSync(piHome(opts)) || commandExistsOnPath("pi", opts.pathEnv);
}

/**
 * Sync-ready probe for OMP.
 *
 * Stricter than host hook detect: peer sync needs `agent.db` (OMP opened at
 * least once). Directory or binary alone is not enough.
 */
export function isOmpSyncReady(opts: PeerAvailabilityOptions = {}): boolean {
  return existsSync(ompDbPath(opts));
}

/** Snapshot of which peer tools can receive a credential mirror right now. */
export function detectPeerAvailability(
  opts: PeerAvailabilityOptions = {}
): PeerAvailability {
  return {
    opencode: isOpencodeSyncReady(opts),
    pi: isPiSyncReady(opts),
    omp: isOmpSyncReady(opts),
  };
}
