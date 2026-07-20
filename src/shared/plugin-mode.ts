/**
 * Pier plugin load mode — separates development (workspace) from release channels.
 *
 * - `workspace`: load first-party (and optional custom) plugins from local package
 *   directories; never pin runtime to GitHub release assets for those plugins.
 * - `release`: production-like managed install/update from official index / bundled tgz.
 *
 * Resolution:
 * 1. Production packaged app → always `release`
 * 2. `PIER_PLUGIN_MODE=workspace|release` when set
 * 3. Dev/test runtime → default `workspace`
 * 4. Otherwise → `release`
 */

export type PierPluginMode = "workspace" | "release";

export const PIER_PLUGIN_MODE_ENV = "PIER_PLUGIN_MODE";

/** Optional workspace roots config (relative to cwd or absolute). */
export interface PluginWorkspaceRootConfig {
  /** Must match plugin.json id when the package is loaded. */
  readonly id: string;
  /** Directory containing plugin.json (+ dist/main.js after build). */
  readonly path: string;
}

export interface PluginWorkspaceConfigFile {
  readonly mode?: PierPluginMode;
  readonly roots?: readonly PluginWorkspaceRootConfig[];
}

export function parsePluginMode(
  raw: string | undefined | null
): PierPluginMode | null {
  if (raw === "workspace" || raw === "release") return raw;
  return null;
}

export function resolvePierPluginMode(options: {
  readonly envMode?: string | null;
  readonly configMode?: PierPluginMode | null;
  readonly isDevRuntime: boolean;
  readonly isPackagedApp: boolean;
}): PierPluginMode {
  if (options.isPackagedApp) {
    return "release";
  }
  const fromEnv = parsePluginMode(options.envMode ?? undefined);
  if (fromEnv) return fromEnv;
  if (options.configMode === "workspace" || options.configMode === "release") {
    return options.configMode;
  }
  return options.isDevRuntime ? "workspace" : "release";
}

export function isWorkspacePluginMode(mode: PierPluginMode): boolean {
  return mode === "workspace";
}

/**
 * The macOS dev shell (Electron runtime copied and renamed to PierDev.app,
 * see scripts/dev-profile.mjs `prepareMacDevElectronRuntime`) reports
 * `app.isPackaged === true` because Electron derives isPackaged from the
 * executable name — renaming `Electron` → `PierDev` flips it. Treating that
 * shell as a production package would force `release` mode unconditionally,
 * so workspace plugin loading could never activate under `pnpm dev`.
 *
 * dev-profile.mjs sets `PIER_DEV_ELECTRON_SHELL=1` when it launches through
 * the renamed shell, so recognition does not depend on the executable name
 * staying in sync between scripts/ and src/. The dev-runtime env check keeps
 * a production package from being flipped by setting the marker alone.
 */
export const PIER_DEV_ELECTRON_SHELL_ENV = "PIER_DEV_ELECTRON_SHELL";

export function isDevShellPackagedOverride(options: {
  readonly devShellMarker: string | undefined;
  readonly isDevRuntime: boolean;
  readonly isPackagedApp: boolean;
}): boolean {
  return (
    options.isPackagedApp &&
    options.isDevRuntime &&
    options.devShellMarker === "1"
  );
}
