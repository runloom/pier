import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { platform } from "node:os";
import { promisify } from "node:util";
import type { AgentInstallInfo } from "@shared/contracts/agent/lifecycle.ts";
import { readCurrentVersionFromPath } from "./current-version.ts";
import { isLegacyKimiCliInstall } from "./kimi-legacy.ts";
import { readVersionAtPath } from "./version-probe.ts";

const execFileAsync = promisify(execFile);

const WHICH_TIMEOUT_MS = 5000;

/**
 * Infer install channel from binary path.
 *
 * Important: `/opt/homebrew/bin/*` alone is **not** Homebrew. Global npm
 * (Homebrew Node prefix), cargo, pip, etc. all land there. True brew
 * packages resolve under Cellar (formula) or Caskroom (cask) after realpath.
 */
export function guessInstallSource(binPath: string): string {
  let resolved = binPath;
  try {
    resolved = realpathSync(binPath);
  } catch {
    // dangling symlink / missing file — fall back to the reported path
  }
  const p = resolved.replace(/\\/g, "/").toLowerCase();

  if (p.includes("/.nvm/") || p.includes("/nvm/versions/")) {
    return "nvm";
  }
  if (p.includes("/.fnm/") || p.includes("/fnm/node-versions/")) {
    return "fnm";
  }
  if (p.includes("/.volta/") || p.includes("/volta/tools/")) {
    return "volta";
  }
  if (p.includes("/.local/share/pnpm") || p.includes("/pnpm/global/")) {
    return "pnpm";
  }
  if (p.includes("/yarn/global/") || p.includes("/.yarn/")) {
    return "yarn";
  }
  // Formula / cask content (after resolving brew bin symlinks)
  if (p.includes("/cellar/") || p.includes("/caskroom/")) {
    return "brew";
  }
  if (p.includes("/scoop/apps/") || p.includes("/scoop/shims/")) {
    return "scoop";
  }
  // WinGet links packages under LocalAppData\Microsoft\WinGet\Packages
  if (p.includes("/winget/packages/") || p.includes("/microsoft/winget/")) {
    return "winget";
  }
  // Bun global installs often symlink into ~/.bun/.../node_modules/...
  if (p.includes("/.bun/") || p.includes("/bun/install/")) {
    return "bun";
  }
  if (
    p.includes("/node_modules/") ||
    p.includes("/lib/node_modules/") ||
    p.includes("/appdata/roaming/npm")
  ) {
    return "npm";
  }
  // Loose "/npm/" matches too many paths (e.g. project folders); keep narrow.
  if (p.includes("/.npm-global/") || p.includes("/npm-global/")) {
    return "npm";
  }
  if (
    p.includes("/.local/share/uv/") ||
    p.includes("/uv/tools/") ||
    p.includes("/.uv/tools/")
  ) {
    return "uv";
  }
  if (p.includes("/pipx/venvs/") || p.includes("/.local/pipx/")) {
    return "pipx";
  }
  if (
    p.includes("\\\\wsl$") ||
    p.includes("/wsl$/") ||
    p.includes("/wsl.localhost/")
  ) {
    return "wsl";
  }
  return "path";
}

async function listPathsForCommand(
  cmd: string,
  env?: NodeJS.ProcessEnv
): Promise<string[]> {
  const isWin = platform() === "win32";
  const binary = isWin ? "where" : "which";
  const args = isWin ? [cmd] : ["-a", cmd];
  try {
    const { stdout } = await execFileAsync(binary, args, {
      env,
      timeout: WHICH_TIMEOUT_MS,
      windowsHide: true,
    });
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    // de-dupe preserving order
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of lines) {
      if (seen.has(line)) {
        continue;
      }
      seen.add(line);
      out.push(line);
    }
    return out;
  } catch {
    return [];
  }
}

function resolvePathKey(binPath: string): string {
  try {
    return realpathSync(binPath);
  } catch {
    return binPath;
  }
}

/**
 * Drop PATH hits that share a short name with a different product.
 * `agent` is Cursor's extra link (skip Grok). `kimi-cli` / uv `kimi` shims
 * are the retired Python CLI (OSC alias only).
 */
export function shouldSkipEnumeratedBin(
  bin: string,
  reportedPath: string,
  resolvedPath: string
): boolean {
  if (
    bin === "agent" &&
    !/cursor-agent/i.test(resolvedPath) &&
    !/cursor-agent/i.test(reportedPath)
  ) {
    return true;
  }
  if (bin === "kimi-cli") {
    return true;
  }
  return (
    bin === "kimi" &&
    (isLegacyKimiCliInstall(reportedPath) ||
      isLegacyKimiCliInstall(resolvedPath))
  );
}

export async function enumerateInstalls(options: {
  bins: readonly string[];
  env?: NodeJS.ProcessEnv;
  versionArgs?: readonly string[];
}): Promise<AgentInstallInfo[]> {
  const versionArgs = options.versionArgs ?? ["--version"];
  const allPaths: string[] = [];
  const seenPaths = new Set<string>();
  const seenResolved = new Set<string>();
  for (const bin of options.bins) {
    const paths = await listPathsForCommand(bin, options.env);
    for (const p of paths) {
      if (seenPaths.has(p)) {
        continue;
      }
      // cursor-agent + agent often symlink to the same binary; also drop
      // unrelated `agent` CLIs (e.g. Grok) that share only the short name.
      const resolved = resolvePathKey(p);
      if (seenResolved.has(resolved)) {
        continue;
      }
      if (shouldSkipEnumeratedBin(bin, p, resolved)) {
        continue;
      }
      seenPaths.add(p);
      seenResolved.add(resolved);
      allPaths.push(p);
    }
  }

  const installs: AgentInstallInfo[] = [];
  for (let i = 0; i < allPaths.length; i += 1) {
    const path = allPaths[i];
    if (!path) {
      continue;
    }
    const pathVersion = readCurrentVersionFromPath(path);
    let ver: { runnable: boolean; version: string | null };
    if (pathVersion) {
      ver = { runnable: true, version: pathVersion };
    } else if (shouldProbeInstallVersion(i)) {
      ver = await readVersionAtPath(path, versionArgs, options.env);
    } else {
      ver = { runnable: true, version: null };
    }
    installs.push({
      isPathDefault: i === 0,
      path,
      runnable: ver.runnable,
      source: guessInstallSource(path),
      version: ver.version,
    });
  }
  return installs;
}

/** Only spawn `--version` on the PATH-default copy (index 0). */
export function shouldProbeInstallVersion(index: number): boolean {
  return index === 0;
}

export function isInstallConflict(
  installs: readonly AgentInstallInfo[]
): boolean {
  if (installs.length < 2) {
    return false;
  }
  const versions = new Set(
    installs.map((i) => i.version ?? (i.runnable ? "?" : "broken"))
  );
  if (versions.size > 1) {
    return true;
  }
  // Same version, multiple locations still a conflict for upgrade anchoring.
  return installs.length >= 2;
}
