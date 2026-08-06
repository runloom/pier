/**
 * Agent surface command builders after resolve (file-size split).
 */
import { accessSync, constants } from "node:fs";
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
 * Build Ghostty-safe surface command after resolve.
 * - absolute: `/bin/sh -c 'exec /abs …'`
 * - via-shell: `$SHELL -lic 'export sticky…; original'`
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
      const rest = name.startsWith("/")
        ? trimmed.slice(name.length)
        : trimmed.slice(name.length);
      const execLine = `exec ${quoteShellArg(abs)}${rest}`;
      return `/bin/sh -c ${quoteShellArg(execLine)}`;
    }
  }

  const body = sticky ? `${sticky}; ${trimmed}` : trimmed;
  return `${quoteShellArg(shell)} ${flags} ${quoteShellArg(body)}`;
}
