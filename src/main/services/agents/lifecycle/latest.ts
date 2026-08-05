import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extractVersionFromOutput } from "@shared/agent-lifecycle/version-compare.ts";
import type { AgentLifecycleSpec } from "./specs/types.ts";
import { resolveUpdateMode } from "./specs/types.ts";

const execFileAsync = promisify(execFile);
const NPM_VIEW_TIMEOUT_MS = 15_000;
const BREW_INFO_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 20 * 60 * 1000;

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
        env,
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
  formula: string,
  tap: string | undefined,
  env?: NodeJS.ProcessEnv
): Promise<string | null> {
  const name = tap ? `${tap}/${formula}` : formula;
  const cacheKey = `brew:${name}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const { stdout } = await execFileAsync(
      "brew",
      ["info", "--json=v2", name],
      {
        env,
        timeout: BREW_INFO_TIMEOUT_MS,
        windowsHide: true,
      }
    );
    const parsed = JSON.parse(stdout) as {
      formulae?: Array<{ versions?: { stable?: string } }>;
    };
    const stable = parsed.formulae?.[0]?.versions?.stable ?? null;
    const version = stable
      ? (extractVersionFromOutput(stable) ?? stable)
      : null;
    cacheSet(cacheKey, version);
    return version;
  } catch {
    cacheSet(cacheKey, null);
    return null;
  }
}

/**
 * Best-effort latest version. Uses npm and/or brew depending on spec.
 * Returns null when offline, unsupported, or reinstall-only.
 */
export async function fetchLatestVersion(
  spec: AgentLifecycleSpec,
  env?: NodeJS.ProcessEnv
): Promise<string | null> {
  const mode = resolveUpdateMode(spec);
  if (mode !== "versioned") {
    return null;
  }

  const npmPkg = resolveNpmPackage(spec);
  if (npmPkg) {
    const v = await fetchNpmLatest(npmPkg, env);
    if (v) {
      return v;
    }
  }

  const brew = resolveBrewFormula(spec);
  if (brew) {
    return fetchBrewLatest(brew.formula, brew.tap, env);
  }

  return null;
}

/** Test-only: clear in-memory latest cache. */
export function clearLatestVersionCache(): void {
  latestCache.clear();
}
