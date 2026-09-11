import type { Environment, RawEnvironment } from "./types.ts";

export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Emulator-owned keys. Dump injects TERM=dumb; Ghostty must set these itself. */
export const TERMINAL_EMULATOR_ENV_KEYS = [
  "COLORTERM",
  "COLUMNS",
  "LINES",
  "TERM",
  "TERMCAP",
  "TERMINFO",
  "TERMINFO_DIRS",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  // Apple Terminal Resume; leaking this + TERM_PROGRAM sources
  // /etc/zshrc_Apple_Terminal and prints "Restored session" in task logs.
  "TERM_SESSION_ID",
] as const;

export function omitTerminalEmulatorEnv(env: Environment): Environment {
  let changed = false;
  const next: Environment = { ...env };
  for (const key of TERMINAL_EMULATOR_ENV_KEYS) {
    if (key in next) {
      Reflect.deleteProperty(next, key);
      changed = true;
    }
  }
  return changed ? next : env;
}

/** Host/dump disable keys must not reach a real PTY; Grok treats any `NO_COLOR` as monochrome. */
export const HOST_COLOR_POLICY_KEYS = [
  "CLICOLOR",
  "CLICOLOR_FORCE",
  "FORCE_COLOR",
  "NO_COLOR",
  "NODE_DISABLE_COLORS",
] as const;

const HOST_COLOR_DISABLE_ALWAYS = new Set(["NO_COLOR", "NODE_DISABLE_COLORS"]);

function isColorDisabledValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "0" ||
    normalized === "false" ||
    normalized === "off" ||
    normalized === "no"
  );
}

export function omitHostColorPolicyEnv(env: Environment): Environment {
  let changed = false;
  const next: Environment = { ...env };
  for (const key of HOST_COLOR_POLICY_KEYS) {
    const value = next[key];
    if (value === undefined) {
      continue;
    }
    if (HOST_COLOR_DISABLE_ALWAYS.has(key) || isColorDisabledValue(value)) {
      Reflect.deleteProperty(next, key);
      changed = true;
    }
  }
  return changed ? next : env;
}

/** Drop host color-disable keys from `process.env` before Ghostty snapshots it. */
export function stripHostColorPolicyFromProcessEnv(
  target: NodeJS.ProcessEnv = process.env
): string[] {
  const removed: string[] = [];
  for (const key of HOST_COLOR_POLICY_KEYS) {
    const value = target[key];
    if (value === undefined) {
      continue;
    }
    if (HOST_COLOR_DISABLE_ALWAYS.has(key) || isColorDisabledValue(value)) {
      Reflect.deleteProperty(target, key);
      removed.push(key);
    }
  }
  return removed;
}

function isPierInternalEsbuildBinaryPath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  return (
    normalized.includes(
      "/Contents/Resources/app.asar.unpacked/node_modules/@esbuild/"
    ) && /\/bin\/esbuild(?:\.exe)?$/u.test(normalized)
  );
}

export function cleanEnv(env: RawEnvironment | undefined): Environment {
  const entries = Object.entries(env ?? {}).filter(
    (entry): entry is [string, string] =>
      ENV_KEY_RE.test(entry[0]) &&
      typeof entry[1] === "string" &&
      !(
        entry[0] === "ESBUILD_BINARY_PATH" &&
        isPierInternalEsbuildBinaryPath(entry[1])
      )
  );
  return Object.fromEntries(entries);
}

/** Latter layers win. Call sites must pass layers in the normative order. */
export function mergeEnv(
  ...layers: Array<Environment | undefined>
): Environment {
  return Object.assign({}, ...layers.map((layer) => cleanEnv(layer)));
}
