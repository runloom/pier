/**
 * Agent surface command builders after resolve (file-size split).
 */
import {
  accessSync,
  closeSync,
  constants,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { pickHostApplyEnv } from "./apply-host-env.ts";
import { agentShellCommandFlags } from "./resolve-user-command-probe.ts";
import {
  extractBareCommandName,
  quoteShellArg,
  type ResolvedUserCommand,
} from "./resolve-user-command-types.ts";

/**
 * Cheap PATH lookup using process env only (no shell spawn).
 */
export function resolveAbsoluteOnPath(
  commandName: string,
  pathEnv: string | undefined
): string | null {
  if (!commandName || commandName.includes("/") || commandName.includes("\\")) {
    if (isAbsolute(commandName)) {
      try {
        accessSync(commandName, constants.X_OK);
        return commandName;
      } catch {
        return null;
      }
    }
    return null;
  }
  const path = pathEnv ?? process.env.PATH ?? "";
  for (const segment of path.split(delimiter)) {
    if (!segment) {
      continue;
    }
    const candidate = join(segment, commandName);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}

export function resolveManyAbsoluteOnPath(
  commandNames: readonly string[],
  pathEnv: string | undefined
): Map<string, string> {
  const hits = new Map<string, string>();
  for (const name of commandNames) {
    const path = resolveAbsoluteOnPath(name, pathEnv);
    if (path) {
      hits.set(name, path);
    }
  }
  return hits;
}

/**
 * Sticky tool env re-applied *after* interactive rc in via-shell launches
 * so PES layers (PATH, NVM_*, project overrides) win over .zshrc rebuilds.
 */
export function buildStickyExportPrelude(env: Record<string, string>): string {
  const sticky = pickHostApplyEnv(env);
  return Object.entries(sticky)
    .map(([key, value]) => `export ${key}=${quoteShellArg(value)}`)
    .join("; ");
}

/**
 * Shebang scripts cannot be the PTY leader; spawn `$SHELL -lic` instead.
 */
export function looksLikeShebangScript(path: string): boolean {
  try {
    const target = realpathSync(path);
    const fd = openSync(target, "r");
    try {
      const buf = Buffer.alloc(2);
      return (
        readSync(fd, buf, 0, 2, 0) === 2 && buf[0] === 0x23 && buf[1] === 0x21
      );
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * Build Ghostty-safe surface command after resolve.
 * Native binary → `/bin/sh -c 'exec …'`. Shebang and via-shell → `$SHELL -lic`.
 */
export function buildResolvedAgentSurfaceCommand(input: {
  commandLine: string;
  env: Record<string, string>;
  resolved: ResolvedUserCommand;
  shell: string;
}): string {
  const trimmed = input.commandLine.trim();
  const shell = input.shell;
  const flags = agentShellCommandFlags(shell);
  const sticky = buildStickyExportPrelude(input.env);

  if (input.resolved.kind === "absolute") {
    const abs = input.resolved.path;
    const name = extractBareCommandName(trimmed);
    if (name) {
      if (looksLikeShebangScript(abs)) {
        const body = sticky ? `${sticky}; ${trimmed}` : trimmed;
        return `${quoteShellArg(shell)} ${flags} ${quoteShellArg(body)}`;
      }
      const rest = name.startsWith("/")
        ? trimmed.slice(name.length)
        : trimmed.slice(name.length);
      return `/bin/sh -c ${quoteShellArg(`exec ${quoteShellArg(abs)}${rest}`)}`;
    }
  }

  const body = sticky ? `${sticky}; ${trimmed}` : trimmed;
  return `${quoteShellArg(shell)} ${flags} ${quoteShellArg(body)}`;
}
