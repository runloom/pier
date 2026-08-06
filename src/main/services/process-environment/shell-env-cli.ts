import type { RawEnvironment } from "./types.ts";

/**
 * Whether the host process already inherited a full user shell environment
 * (VS Code: `VSCODE_CLI=1`). When true, login-shell dump is skipped.
 *
 * - `PIER_FORCE_USER_ENV=1` forces a dump even if CLI markers are present.
 * - `PIER_CLI=1` / `PIER_LAUNCHED_FROM_CLI=1` mark pier CLI / terminal launch.
 */
export function isLaunchedFromCli(env: RawEnvironment = process.env): boolean {
  if (env.PIER_FORCE_USER_ENV === "1") {
    return false;
  }
  return env.PIER_CLI === "1" || env.PIER_LAUNCHED_FROM_CLI === "1";
}
