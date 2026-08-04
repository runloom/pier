import type { Environment, RawEnvironment } from "./types.ts";

export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
