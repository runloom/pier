// Class B: version probes after host env (curl/npm/brew with optional PES env).
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { extractVersionFromOutput } from "@shared/agent-lifecycle/version-compare.ts";
import { fetchBrewLatest } from "./latest-brew.ts";
import { fetchLatestProbe } from "./latest-http.ts";
import {
  brewPackageTokenFromBinPath,
  resolveBrewQueryName,
} from "./plan/brew-token.ts";
import { isPathLikeSource } from "./plan/source-policy.ts";
import type { AgentLifecycleSpec } from "./specs/types.ts";
import { resolveUpdateMode } from "./specs/types.ts";

export { parseBrewInfoVersion } from "./latest-brew.ts";

const NPM_VIEW_TIMEOUT_MS = 15_000;
const PYPI_TIMEOUT_MS = 15_000;
/** Align with host-catalog agent-cli remote TTL (10 min). */
const CACHE_TTL_OK_MS = 10 * 60 * 1000;
/** Short negative cache so a flaky probe does not stick for a full window. */
const CACHE_TTL_MISS_MS = 60 * 1000;

/**
 * Callback-style execFile → Promise. Avoid util.promisify(execFile): Node's
 * custom promisify can bypass test doubles of `execFile`.
 */
function execFileAsync(
  file: string,
  args: readonly string[],
  options: {
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    windowsHide?: boolean;
  }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        env: options.env,
        timeout: options.timeout,
        windowsHide: options.windowsHide,
        encoding: "utf8",
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({
          stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
          stderr: typeof stderr === "string" ? stderr : String(stderr ?? ""),
        });
      }
    );
  });
}

const latestCache = new Map<
  string,
  { at: number; version: string | null; ttlMs: number }
>();

function cacheGet(key: string, force?: boolean): string | null | undefined {
  if (force === true) {
    return;
  }
  const hit = latestCache.get(key);
  if (!hit) {
    return;
  }
  if (Date.now() - hit.at > hit.ttlMs) {
    latestCache.delete(key);
    return;
  }
  return hit.version;
}

function cacheSet(key: string, version: string | null): void {
  latestCache.set(key, {
    at: Date.now(),
    version,
    ttlMs: version === null ? CACHE_TTL_MISS_MS : CACHE_TTL_OK_MS,
  });
}

function resolveNpmPackage(spec: AgentLifecycleSpec): string | null {
  if (spec.npmPackageForLatest) {
    return spec.npmPackageForLatest;
  }
  const npmChannel = spec.install.find((c) => c.kind === "npm");
  return npmChannel && npmChannel.kind === "npm" ? npmChannel.package : null;
}

function resolveBrewFormula(
  spec: AgentLifecycleSpec
): { formula: string; tap?: string } | null {
  const brew = spec.install.find((c) => c.kind === "brew");
  if (brew?.kind !== "brew") {
    return null;
  }
  return brew.tap
    ? { formula: brew.formula, tap: brew.tap }
    : { formula: brew.formula };
}

function resolveUvPackage(spec: AgentLifecycleSpec): string | null {
  const uv = spec.install.find((c) => c.kind === "uv");
  return uv?.kind === "uv" ? uv.package : null;
}

function resolvePipxPackage(spec: AgentLifecycleSpec): string | null {
  const pipx = spec.install.find((c) => c.kind === "pipx");
  return pipx?.kind === "pipx" ? pipx.package : null;
}

/** PyPI name: uv tool first, then pipx (same index for both installers). */
function resolvePypiPackage(spec: AgentLifecycleSpec): string | null {
  return resolveUvPackage(spec) ?? resolvePipxPackage(spec);
}

function resolveClaudeConfigDir(
  env: NodeJS.ProcessEnv | undefined,
  homeDir: string | undefined
): string {
  const override =
    env?.CLAUDE_CONFIG_DIR?.trim() ||
    (env === undefined ? process.env.CLAUDE_CONFIG_DIR?.trim() : "");
  if (override) {
    return override;
  }
  return join(homeDir ?? homedir(), ".claude");
}

/** Claude native channel from CLAUDE_CONFIG_DIR/settings.json; default latest. */
export async function readClaudeAutoUpdatesChannel(options?: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): Promise<"latest" | "stable"> {
  const configDir = resolveClaudeConfigDir(options?.env, options?.homeDir);
  try {
    const raw = await readFile(join(configDir, "settings.json"), "utf8");
    const parsed = JSON.parse(raw) as { autoUpdatesChannel?: unknown };
    return parsed.autoUpdatesChannel === "stable" ? "stable" : "latest";
  } catch {
    return "latest";
  }
}

async function fetchPypiLatest(
  packageName: string,
  env?: NodeJS.ProcessEnv,
  force?: boolean
): Promise<string | null> {
  const cacheKey = `pypi:${packageName}`;
  const cached = cacheGet(cacheKey, force);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const { stdout } = await execFileAsync(
      "curl",
      [
        "-fsSL",
        `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`,
      ],
      {
        ...(env === undefined ? {} : { env }),
        timeout: PYPI_TIMEOUT_MS,
        windowsHide: true,
      }
    );
    const parsed = JSON.parse(stdout) as { info?: { version?: string } };
    const raw = parsed.info?.version ?? null;
    const version = raw ? (extractVersionFromOutput(raw) ?? raw) : null;
    cacheSet(cacheKey, version);
    return version;
  } catch {
    cacheSet(cacheKey, null);
    return null;
  }
}

async function fetchNpmLatest(
  packageName: string,
  env?: NodeJS.ProcessEnv,
  force?: boolean
): Promise<string | null> {
  const cacheKey = `npm:${packageName}`;
  const cached = cacheGet(cacheKey, force);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const { stdout } = await execFileAsync(
      "npm",
      ["view", packageName, "version", "--json"],
      {
        ...(env === undefined ? {} : { env }),
        timeout: NPM_VIEW_TIMEOUT_MS,
        windowsHide: true,
      }
    );
    const text = stdout.trim();
    if (!text) {
      cacheSet(cacheKey, null);
      return null;
    }
    let version: string | null = null;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "string") {
        version = extractVersionFromOutput(parsed) ?? parsed;
      }
    } catch {
      version = extractVersionFromOutput(text) ?? text.replace(/^"|"$/g, "");
    }
    cacheSet(cacheKey, version);
    return version;
  } catch {
    cacheSet(cacheKey, null);
    return null;
  }
}

function resolveBrewChannel(spec: AgentLifecycleSpec): {
  formula: string;
  tap?: string;
  cask: boolean;
} | null {
  const brew = resolveBrewFormula(spec);
  if (!brew) {
    return null;
  }
  const channel = spec.install.find((c) => c.kind === "brew");
  const cask = channel?.kind === "brew" && channel.cask === true;
  return brew.tap
    ? { formula: brew.formula, tap: brew.tap, cask }
    : { formula: brew.formula, cask };
}

export interface FetchLatestVersionOptions {
  defaultBinPath?: string | null;
  /** Bypass in-memory latest cache (settings refresh / catalog force). */
  force?: boolean;
  /** Override home for Claude channel settings (tests). */
  homeDir?: string;
  installSource?: string | null;
}

/**
 * Best-effort latest version. Prefer the channel that matches the install
 * source so brew/uv installs are not compared against an unrelated npm tag
 * (false "update available" → no-op upgrade → sticky Update all).
 *
 * Brew queries use the installed Cellar/Caskroom token when known
 * (`claude-code@latest` ≠ stable `claude-code`). Fall through only within
 * the same install ecosystem when source is unknown. Path/script uses
 * `latestProbe` when declared (Claude native, Cursor script, Kimi Code,
 * Goose GitHub). Never compare Claude / Kimi Code path installs to a
 * different package line.
 */
export async function fetchLatestVersion(
  spec: AgentLifecycleSpec,
  env?: NodeJS.ProcessEnv,
  options?: FetchLatestVersionOptions
): Promise<string | null> {
  const mode = resolveUpdateMode(spec);
  if (mode !== "versioned") {
    return null;
  }

  const force = options?.force === true;
  const source = (options?.installSource ?? "").toLowerCase();
  const npmPkg = resolveNpmPackage(spec);
  const brew = resolveBrewChannel(spec);
  const pypiPkg = resolvePypiPackage(spec);
  const preferBrew = source === "brew";
  const preferNpm =
    source === "npm" ||
    source === "nvm" ||
    source === "fnm" ||
    source === "volta" ||
    source === "pnpm" ||
    source === "yarn" ||
    source === "bun";
  const preferPypi =
    source === "uv" || source.includes("uv") || source === "pipx";

  const tryBrew = async (): Promise<string | null> => {
    if (!brew) {
      return null;
    }
    const installedToken = brewPackageTokenFromBinPath(options?.defaultBinPath);
    const name = resolveBrewQueryName(brew, installedToken);
    const cacheKey = `brew:${brew.cask ? "cask:" : ""}${name}`;
    const cached = cacheGet(cacheKey, force);
    if (cached !== undefined) {
      return cached;
    }
    const version = await fetchBrewLatest(name, env, brew.cask);
    cacheSet(cacheKey, version);
    return version;
  };
  const tryNpm = async (): Promise<string | null> => {
    if (!npmPkg) {
      return null;
    }
    return fetchNpmLatest(npmPkg, env, force);
  };
  const tryPypi = async (): Promise<string | null> => {
    if (!pypiPkg) {
      return null;
    }
    return fetchPypiLatest(pypiPkg, env, force);
  };
  const tryHttp = async (): Promise<string | null> => {
    if (!spec.latestProbe) {
      return null;
    }
    let httpChannel: "latest" | "stable" | null = null;
    if (
      spec.agentId === "claude" &&
      spec.latestProbe.kind === "http-text" &&
      spec.latestProbe.stableUrl
    ) {
      httpChannel = await readClaudeAutoUpdatesChannel({
        ...(env === undefined ? {} : { env }),
        ...(options?.homeDir === undefined ? {} : { homeDir: options.homeDir }),
      });
    }
    const cacheKey = `http:${spec.latestProbe.kind}:${spec.latestProbe.url}:${httpChannel ?? "default"}`;
    const cached = cacheGet(cacheKey, force);
    if (cached !== undefined) {
      return cached;
    }
    const version = await fetchLatestProbe(spec.latestProbe, env, {
      httpChannel,
    });
    cacheSet(cacheKey, version);
    return version;
  };

  if (preferBrew) {
    // Same install ecosystem only — do not compare brew installs to npm tags.
    return tryBrew();
  }
  if (preferNpm) {
    return tryNpm();
  }
  if (preferPypi) {
    // Never fall back to npm when uv/pipx is the install source — different
    // package names are not comparable.
    return tryPypi();
  }

  if (isPathLikeSource(source) && spec.latestProbe) {
    return tryHttp();
  }

  // Path / script / unknown without latestProbe: PyPI for uv/pipx-only
  // agents (mistral-vibe); otherwise npm then brew.
  if (pypiPkg) {
    const fromPypi = await tryPypi();
    if (fromPypi) {
      return fromPypi;
    }
    // Only use npm when there is no separate PyPI package line.
    if (!npmPkg || npmPkg === pypiPkg) {
      return tryNpm();
    }
    return null;
  }
  return (await tryNpm()) ?? (await tryBrew());
}

/** Test-only: clear in-memory latest cache. */
export function clearLatestVersionCache(): void {
  latestCache.clear();
}
