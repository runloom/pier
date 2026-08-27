/**
 * Resolve a bare command name the way the user's interactive shell would.
 *
 * Gold standard (P0): PES owns env layers; this owns *name → how to run*.
 * - External on PATH → absolute path (spawn with env, no second full rc for life).
 * - Alias / function → run via user shell -lic. Parent env overlay carries
 *   agent keys; do not re-export dump PATH after rc.
 *
 * Probe is cached; product dump hardening lives in shell-env-loader.ts (P2).
 */
import { accessSync, constants } from "node:fs";
import { isAbsolute } from "node:path";
import {
  buildUserCommandProbeScript,
  parseUserCommandProbeOutput,
  runUserCommandProbe,
  shellFamily,
} from "./resolve-user-command-probe.ts";
import { resolveAbsoluteOnPath } from "./resolve-user-command-surface.ts";
import {
  DETECT_COMMAND_RESOLVE_TIMEOUT_MS,
  type ResolvedUserCommand,
  type ResolveUserCommandRequest,
  resolveWrapperShell,
} from "./resolve-user-command-types.ts";
import { DEFAULT_SHELL_ENV_TIMEOUT_MS } from "./shell-env-loader.ts";

export {
  agentShellCommandFlags,
  buildUserCommandProbeScript,
  extractProbeProtocolBody,
  isAlreadyShellWrappedCommand,
  PIER_CMD_END,
  PIER_CMD_START,
  parseUserCommandProbeOutput,
  shellFamily,
} from "./resolve-user-command-probe.ts";
export {
  buildResolvedAgentSurfaceCommand,
  buildStickyExportPrelude,
  looksLikeShebangScript,
  resolveAbsoluteOnPath,
  resolveManyAbsoluteOnPath,
} from "./resolve-user-command-surface.ts";
export type {
  ResolvedUserCommand,
  ResolveUserCommandRequest,
} from "./resolve-user-command-types.ts";
export {
  DETECT_COMMAND_RESOLVE_TIMEOUT_MS,
  extractBareCommandName,
  PANEL_COMMAND_RESOLVE_TIMEOUT_MS,
  quoteShellArg,
  resolveWrapperShell,
} from "./resolve-user-command-types.ts";

const RESOLVE_CACHE_TTL_MS = 60_000;
const NEGATIVE_CACHE_TTL_MS = 5000;
const MAX_CACHE_ENTRIES = 256;

interface CacheEntry {
  result: ResolvedUserCommand;
  until: number;
}

const resolveCache = new Map<string, CacheEntry>();

function cacheKey(req: {
  commandName: string;
  cwd?: string | undefined;
  pathEnv: string;
  pathOnly: boolean;
  shell: string;
}): string {
  return `${req.shell}\0${req.cwd ?? ""}\0${req.commandName}\0${req.pathEnv}\0${req.pathOnly ? "1" : "0"}`;
}

function trimCache(): void {
  if (resolveCache.size <= MAX_CACHE_ENTRIES) {
    return;
  }
  const now = Date.now();
  for (const [key, entry] of resolveCache) {
    if (entry.until <= now) {
      resolveCache.delete(key);
    }
  }
  while (resolveCache.size > MAX_CACHE_ENTRIES) {
    const first = resolveCache.keys().next().value;
    if (first === undefined) {
      break;
    }
    resolveCache.delete(first);
  }
}

/** Invalidate resolve cache (tests / shell-env invalidate / detect refresh). */
export function clearUserCommandResolveCache(): void {
  resolveCache.clear();
}

function cachePut(
  key: string,
  result: ResolvedUserCommand,
  ttlMs: number
): void {
  resolveCache.set(key, { result, until: Date.now() + ttlMs });
  trimCache();
}

/**
 * Resolve bare command name. Windows: PATH-only which via filesystem walk.
 */
export async function resolveUserCommand(
  request: ResolveUserCommandRequest
): Promise<ResolvedUserCommand> {
  const commandName = request.commandName.trim();
  if (!commandName || /\s/.test(commandName)) {
    return {
      kind: "missing",
      error: "command name must be a single bare token",
    };
  }
  if (commandName.startsWith("/") || isAbsolute(commandName)) {
    try {
      accessSync(commandName, constants.X_OK);
      return { kind: "absolute", path: commandName };
    } catch {
      return { kind: "missing", error: `not executable: ${commandName}` };
    }
  }

  const shell = request.shell ?? resolveWrapperShell(request.env);
  const env = { ...(request.env ?? {}) };
  Reflect.deleteProperty(env, "PIER_RESOLVING_ENVIRONMENT");
  const pathEnv = env.PATH ?? "";
  const pathOnly = request.pathOnly === true;
  const key = cacheKey({
    commandName,
    cwd: request.cwd,
    pathEnv,
    pathOnly,
    shell,
  });
  const cached = resolveCache.get(key);
  const now = Date.now();
  if (cached && cached.until > now) {
    return cached.result;
  }

  const onPath = resolveAbsoluteOnPath(commandName, pathEnv);
  if (onPath) {
    const result: ResolvedUserCommand = { kind: "absolute", path: onPath };
    cachePut(key, result, RESOLVE_CACHE_TTL_MS);
    return result;
  }

  if (pathOnly || process.platform === "win32") {
    const result: ResolvedUserCommand = {
      kind: "missing",
      error: "command not found on PATH",
    };
    cachePut(key, result, NEGATIVE_CACHE_TTL_MS);
    return result;
  }

  const timeoutMs =
    request.timeoutMs ??
    Math.min(DEFAULT_SHELL_ENV_TIMEOUT_MS, DETECT_COMMAND_RESOLVE_TIMEOUT_MS);
  const family = shellFamily(shell);
  try {
    const probed = await runUserCommandProbe({
      cwd: request.cwd,
      env: {
        ...env,
        TERM: env.TERM ?? "dumb",
      },
      script: buildUserCommandProbeScript(commandName, family),
      shell,
      timeoutMs,
    });
    const result = parseUserCommandProbeOutput(probed.stdout);
    const ttl =
      result.kind === "missing" ? NEGATIVE_CACHE_TTL_MS : RESOLVE_CACHE_TTL_MS;
    cachePut(key, result, ttl);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: ResolvedUserCommand = {
      kind: "missing",
      error: message,
    };
    cachePut(key, result, NEGATIVE_CACHE_TTL_MS);
    return result;
  }
}
