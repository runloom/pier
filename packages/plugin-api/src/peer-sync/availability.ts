import { spawnSync } from "node:child_process";
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

/** First pi release with built-in xAI device-code OAuth (subscription login). */
export const PI_XAI_OAUTH_MIN_VERSION = {
  major: 0,
  minor: 80,
  patch: 8,
} as const;

export interface PeerAvailabilityOptions {
  /** Override home directory (tests). */
  homeDir?: string;
  /** Override OpenCode data dir (tests). Defaults to `~/.local/share/opencode`. */
  opencodeDataDir?: string;
  /** Override PATH for binary probes (tests). */
  pathEnv?: string;
  /**
   * Optional version probe for tests. When provided, skips spawning `pi
   * --version`. Return null to simulate an unreadable / failing binary.
   */
  piVersionProbe?: () => string | null;
}

function resolveHomeDir(opts: PeerAvailabilityOptions): string {
  return opts.homeDir ?? homedir();
}

function commandExistsOnPath(
  command: string,
  pathEnv: string | undefined
): boolean {
  return findCommandOnPath(command, pathEnv) !== null;
}

function findCommandOnPath(
  command: string,
  pathEnv: string | undefined
): string | null {
  const env = pathEnv ?? process.env.PATH ?? "";
  for (const dir of env.split(delimiter)) {
    if (dir.length === 0) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
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
 * location written by Codex / Grok peer sync. Does not imply xAI OAuth
 * support — see `isPiOauthCapable`.
 */
export function isPiSyncReady(opts: PeerAvailabilityOptions = {}): boolean {
  return existsSync(piHome(opts)) || commandExistsOnPath("pi", opts.pathEnv);
}

/**
 * Parse the first `major.minor.patch` triple from `pi --version` output.
 */
export function parsePiVersion(
  raw: string
): { major: number; minor: number; patch: number } | null {
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (
    !(
      Number.isInteger(major) &&
      Number.isInteger(minor) &&
      Number.isInteger(patch)
    )
  ) {
    return null;
  }
  return { major, minor, patch };
}

export function isPiVersionAtLeast(
  version: { major: number; minor: number; patch: number },
  min: { major: number; minor: number; patch: number }
): boolean {
  if (version.major !== min.major) return version.major > min.major;
  if (version.minor !== min.minor) return version.minor > min.minor;
  return version.patch >= min.patch;
}

/**
 * Whether this pi release can consume xAI OAuth credentials (subscription
 * login). Requires pi ≥ 0.80.8. Fail closed when the binary or version string
 * cannot be verified so OIDC sync never reports a silent false success.
 */
export function isPiOauthCapable(opts: PeerAvailabilityOptions = {}): boolean {
  if (!isPiSyncReady(opts)) {
    return false;
  }

  let raw: string | null;
  if (opts.piVersionProbe) {
    raw = opts.piVersionProbe();
  } else {
    const binary = findCommandOnPath("pi", opts.pathEnv);
    if (!binary) {
      // Agent dir alone is not enough to prove oauth support.
      return false;
    }
    const result = spawnSync(binary, ["--version"], {
      encoding: "utf-8",
      env: {
        ...process.env,
        ...(opts.pathEnv === undefined ? {} : { PATH: opts.pathEnv }),
      },
      timeout: 2000,
    });
    if (result.error || (result.status !== 0 && result.status !== null)) {
      return false;
    }
    raw = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  }

  if (raw === null || raw.trim().length === 0) {
    return false;
  }
  const parsed = parsePiVersion(raw);
  if (!parsed) {
    return false;
  }
  return isPiVersionAtLeast(parsed, PI_XAI_OAUTH_MIN_VERSION);
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
  const pi = isPiSyncReady(opts);
  return {
    opencode: isOpencodeSyncReady(opts),
    pi,
    piOauthCapable: pi ? isPiOauthCapable(opts) : false,
    omp: isOmpSyncReady(opts),
  };
}
