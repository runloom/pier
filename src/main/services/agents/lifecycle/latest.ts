// Class B: version probes after host env (curl/npm/brew with optional PES env).
import { execFile } from "node:child_process";
import { extractVersionFromOutput } from "@shared/agent-lifecycle/version-compare.ts";
import {
  brewPackageTokenFromBinPath,
  resolveBrewQueryName,
} from "./plan/brew-token.ts";
import type { AgentLifecycleSpec } from "./specs/types.ts";
import { resolveUpdateMode } from "./specs/types.ts";

const NPM_VIEW_TIMEOUT_MS = 15_000;
const BREW_INFO_TIMEOUT_MS = 20_000;
const PYPI_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 20 * 60 * 1000;

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

const latestCache = new Map<string, { at: number; version: string | null }>();

function cacheGet(key: string): string | null | undefined {
  const hit = latestCache.get(key);
  if (!hit) {
    return;
  }
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    latestCache.delete(key);
    return;
  }
  return hit.version;
}

function cacheSet(key: string, version: string | null): void {
  latestCache.set(key, { at: Date.now(), version });
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

/**
 * PyPI JSON for uv-tool packages (e.g. kimi-cli). Not interchangeable with
 * npmPackageForLatest when the npm name is a different product line.
 */
async function fetchPypiLatest(
  packageName: string,
  env?: NodeJS.ProcessEnv
): Promise<string | null> {
  const cacheKey = `pypi:${packageName}`;
  const cached = cacheGet(cacheKey);
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
  env?: NodeJS.ProcessEnv
): Promise<string | null> {
  const cacheKey = `npm:${packageName}`;
  const cached = cacheGet(cacheKey);
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

async function fetchBrewLatest(
  name: string,
  env?: NodeJS.ProcessEnv,
  isCask?: boolean
): Promise<string | null> {
  const cacheKey = `brew:${isCask ? "cask:" : ""}${name}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  try {
    // Casks need --cask for some tokens; bare info also returns `casks` for
    // known cask names (claude-code@latest, copilot-cli, codex).
    const args =
      isCask === true
        ? (["info", "--json=v2", "--cask", name] as const)
        : (["info", "--json=v2", name] as const);
    const { stdout } = await execFileAsync("brew", [...args], {
      ...(env === undefined ? {} : { env }),
      timeout: BREW_INFO_TIMEOUT_MS,
      windowsHide: true,
    });
    const version = parseBrewInfoVersion(stdout);
    cacheSet(cacheKey, version);
    return version;
  } catch {
    cacheSet(cacheKey, null);
    return null;
  }
}

/** Exported for unit tests — formula stable first, then cask version. */
export function parseBrewInfoVersion(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as {
      casks?: Array<{ version?: string }>;
      formulae?: Array<{ versions?: { stable?: string } }>;
    };
    const formulaStable = parsed.formulae?.[0]?.versions?.stable ?? null;
    const caskVersion = parsed.casks?.[0]?.version ?? null;
    const stable = formulaStable ?? caskVersion;
    if (!stable) {
      return null;
    }
    return extractVersionFromOutput(stable) ?? stable;
  } catch {
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

/**
 * Best-effort latest version. Prefer the channel that matches the install
 * source so brew/uv installs are not compared against an unrelated npm tag
 * (false "update available" → no-op upgrade → sticky Update all).
 *
 * Brew queries use the installed Cellar/Caskroom token when known
 * (`claude-code@latest` ≠ stable `claude-code`). Fall through only within
 * the same install ecosystem (brew↔npm for JS tools; uv/pipx PyPI for
 * Python tools). Path/script installs that declare a uv/pipx channel
 * (kimi, mistral-vibe) probe PyPI, not npmPackageForLatest.
 */
export async function fetchLatestVersion(
  spec: AgentLifecycleSpec,
  env?: NodeJS.ProcessEnv,
  options?: { defaultBinPath?: string | null; installSource?: string | null }
): Promise<string | null> {
  const mode = resolveUpdateMode(spec);
  if (mode !== "versioned") {
    return null;
  }

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
    return fetchBrewLatest(name, env, brew.cask);
  };
  const tryNpm = async (): Promise<string | null> => {
    if (!npmPkg) {
      return null;
    }
    return fetchNpmLatest(npmPkg, env);
  };
  const tryPypi = async (): Promise<string | null> => {
    if (!pypiPkg) {
      return null;
    }
    return fetchPypiLatest(pypiPkg, env);
  };

  if (preferBrew) {
    return (await tryBrew()) ?? (await tryNpm());
  }
  if (preferNpm) {
    return (await tryNpm()) ?? (await tryBrew());
  }
  if (preferPypi) {
    // Never fall back to npm when uv/pipx is the install source — different
    // package names (kimi-cli vs @moonshot-ai/kimi-code) are not comparable.
    return tryPypi();
  }

  // Path / script / unknown: prefer uv/pipx PyPI when the agent declares a
  // Python channel (official kimi / mistral-vibe scripts); otherwise npm then brew.
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
