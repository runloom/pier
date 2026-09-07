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
 * so NVM_DIR / CODEX_HOME etc. survive .zshrc. PATH and MANPATH are not
 * re-exported: a second login+interactive shell rebuilds PATH from rc
 * (nvm vs mise shims). Agent env overlays stay on the parent spawn env.
 */
const STICKY_SKIP_KEYS = new Set(["MANPATH", "PATH"]);

export function buildStickyExportPrelude(env: Record<string, string>): string {
  const sticky = pickHostApplyEnv(env);
  return Object.entries(sticky)
    .filter(([key]) => !STICKY_SKIP_KEYS.has(key))
    .map(([key, value]) => `export ${key}=${quoteShellArg(value)}`)
    .join("; ");
}

/**
 * Detect scripts that require the user's login-shell environment before exec.
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
 * Native binary → `/bin/sh -c 'exec …'`. Shebang → `$SHELL -lic 'exec …'`.
 * Resolved agents replace the wrapper, keeping their children in the owned group.
 */
export function buildResolvedAgentSurfaceCommand(input: {
  commandLine: string;
  /** Verified literal arguments, appended only at this final spawn boundary. */
  literalArgs?: readonly string[];
  env: Record<string, string>;
  resolved: ResolvedUserCommand;
  shell: string;
}): string {
  const trimmed = input.commandLine.trim();
  const shell = input.shell;
  const flags = agentShellCommandFlags(shell);
  const sticky = buildStickyExportPrelude(input.env);
  const extra = input.literalArgs?.length
    ? ` ${input.literalArgs.map(quoteShellArg).join(" ")}`
    : "";

  if (input.resolved.kind === "absolute") {
    const abs = input.resolved.path;
    const name = extractBareCommandName(trimmed);
    if (name) {
      const execution = `exec ${quoteShellArg(abs)}${trimmed.slice(name.length)}${extra}`;
      if (looksLikeShebangScript(abs)) {
        const body = sticky ? `${sticky}; ${execution}` : execution;
        return `${quoteShellArg(shell)} ${flags} ${quoteShellArg(body)}`;
      }
      return `/bin/sh -c ${quoteShellArg(execution)}`;
    }
  }

  const body = sticky ? `${sticky}; ${trimmed}${extra}` : `${trimmed}${extra}`;
  return `${quoteShellArg(shell)} ${flags} ${quoteShellArg(body)}`;
}
