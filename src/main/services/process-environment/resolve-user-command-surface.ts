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
  statSync,
} from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";
import { pickHostApplyEnv } from "./apply-host-env.ts";
import {
  agentShellCommandFlags,
  shellFamily,
} from "./resolve-user-command-probe.ts";
import {
  extractBareCommandName,
  quoteShellArg,
  type ResolvedUserCommand,
} from "./resolve-user-command-types.ts";

const DEFAULT_WIN_PATHEXT = ".EXE;.CMD;.BAT;.COM";

/**
 * Names to try in one PATH directory. Windows tries the bare name first, then
 * PATHEXT, and does not append a suffix the name already has (`gradlew.bat`).
 */
export function pathLookupNames(
  name: string,
  platform: NodeJS.Platform = process.platform,
  pathext: string | undefined = process.env.PATHEXT
): readonly string[] {
  if (platform !== "win32") {
    return [name];
  }
  const suffixes = (
    pathext && pathext.length > 0 ? pathext : DEFAULT_WIN_PATHEXT
  )
    .split(";")
    .filter((suffix) => suffix.length > 0);
  const current = extname(name);
  if (
    current.length > 0 &&
    suffixes.some((suffix) => suffix.toLowerCase() === current.toLowerCase())
  ) {
    return [name];
  }
  return [name, ...suffixes.map((suffix) => `${name}${suffix}`)];
}

function isExecutableFile(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Cheap PATH lookup using process env only (no shell spawn).
 * Requires an executable file. Windows `X_OK` is existence.
 */
export function resolveAbsoluteOnPath(
  commandName: string,
  pathEnv: string | undefined
): string | null {
  if (!commandName || commandName.includes("/") || commandName.includes("\\")) {
    if (isAbsolute(commandName)) {
      return isExecutableFile(commandName) ? commandName : null;
    }
    return null;
  }
  const path = pathEnv ?? process.env.PATH ?? "";
  for (const segment of path.split(delimiter)) {
    if (!segment) {
      continue;
    }
    for (const fileName of pathLookupNames(commandName)) {
      const candidate = join(segment, fileName);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
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

const HOST_COLOR_VALUE_DEPENDENT_KEYS = [
  "CLICOLOR",
  "CLICOLOR_FORCE",
  "FORCE_COLOR",
] as const;

function posixHostColorPolicyUnset(): string {
  const byValue = HOST_COLOR_VALUE_DEPENDENT_KEYS.map(
    (key) =>
      `case $(printf %s "\${${key}-}" | tr "[:upper:]" "[:lower:]") in 0|false|off|no|"") unset ${key};; esac`
  ).join("; ");
  return `unset NO_COLOR NODE_DISABLE_COLORS; ${byValue}`;
}

function fishHostColorPolicyUnset(): string {
  const always = "set -e NO_COLOR; set -e NODE_DISABLE_COLORS";
  const byValue = HOST_COLOR_VALUE_DEPENDENT_KEYS.map(
    (key) =>
      `set -l _pier_${key} (string lower -- $${key}); if test -z "$_pier_${key}"; or contains -- "$_pier_${key}" 0 false off no; set -e ${key}; end`
  ).join("; ");
  return `${always}; ${byValue}`;
}

function nuHostColorPolicyUnset(): string {
  const always = "hide-env -i NO_COLOR; hide-env -i NODE_DISABLE_COLORS";
  const byValue = HOST_COLOR_VALUE_DEPENDENT_KEYS.map(
    (key) =>
      `if ($env.${key}? | default "" | str downcase) in ["" "0" "false" "off" "no"] { hide-env -i ${key} }`
  ).join("; ");
  return `${always}; ${byValue}`;
}

export function hostColorPolicyUnsetPrelude(shellPath?: string): string {
  const family = shellPath ? shellFamily(shellPath) : "posix";
  if (family === "fish") {
    return fishHostColorPolicyUnset();
  }
  if (family === "nu") {
    return nuHostColorPolicyUnset();
  }
  return posixHostColorPolicyUnset();
}

function withHostColorPolicyUnset(body: string, shellPath?: string): string {
  const prelude = hostColorPolicyUnsetPrelude(shellPath);
  return body ? `${prelude}; ${body}` : prelude;
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
        const inner = sticky ? `${sticky}; ${execution}` : execution;
        return `${quoteShellArg(shell)} ${flags} ${quoteShellArg(
          withHostColorPolicyUnset(inner, shell)
        )}`;
      }
      return `/bin/sh -c ${quoteShellArg(withHostColorPolicyUnset(execution))}`;
    }
  }

  const inner = sticky ? `${sticky}; ${trimmed}${extra}` : `${trimmed}${extra}`;
  return `${quoteShellArg(shell)} ${flags} ${quoteShellArg(
    withHostColorPolicyUnset(inner, shell)
  )}`;
}
