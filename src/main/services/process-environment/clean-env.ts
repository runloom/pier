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
