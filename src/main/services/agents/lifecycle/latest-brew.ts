// Class B: Homebrew latest via formulae.brew.sh; tap-only local brew info fallback.
import { execFile } from "node:child_process";
import { extractVersionFromOutput } from "@shared/agent-lifecycle/version-compare.ts";
import { assertLatestHttpsUrl } from "./latest-hosts.ts";

const BREW_INFO_TIMEOUT_MS = 20_000;
const BREW_API_TIMEOUT_MS = 15_000;

function execFileUtf8(
  file: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        ...(options.env === undefined ? {} : { env: options.env }),
        timeout: options.timeout,
        windowsHide: true,
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

export function parseBrewRemoteCaskVersion(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { version?: string };
    const raw = parsed.version ?? null;
    return raw ? (extractVersionFromOutput(raw) ?? raw) : null;
  } catch {
    return null;
  }
}

export function parseBrewRemoteFormulaVersion(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { versions?: { stable?: string } };
    const raw = parsed.versions?.stable ?? null;
    return raw ? (extractVersionFromOutput(raw) ?? raw) : null;
  } catch {
    return null;
  }
}

/** Core names have formulae.brew.sh JSON; taps (`owner/tap/name`) do not. */
export function isBrewCoreToken(name: string): boolean {
  return name.length > 0 && !name.includes("/");
}

function brewRemoteApiUrl(name: string, isCask: boolean): string {
  const encoded = encodeURIComponent(name);
  return isCask
    ? `https://formulae.brew.sh/api/cask/${encoded}.json`
    : `https://formulae.brew.sh/api/formula/${encoded}.json`;
}

async function fetchBrewRemoteApi(
  name: string,
  isCask: boolean,
  env?: NodeJS.ProcessEnv
): Promise<string | null> {
  if (!isBrewCoreToken(name)) {
    return null;
  }
  const url = brewRemoteApiUrl(name, isCask);
  try {
    assertLatestHttpsUrl(url);
    const { stdout } = await execFileUtf8("curl", ["-fsSL", url], {
      ...(env === undefined ? {} : { env }),
      timeout: BREW_API_TIMEOUT_MS,
    });
    return isCask
      ? parseBrewRemoteCaskVersion(stdout)
      : parseBrewRemoteFormulaVersion(stdout);
  } catch {
    // Wrong kind (cask vs formula) or network — caller tries the other shape.
    return null;
  }
}

async function fetchBrewLocalInfo(
  name: string,
  env?: NodeJS.ProcessEnv,
  isCask?: boolean
): Promise<string | null> {
  try {
    const args =
      isCask === true
        ? (["info", "--json=v2", "--cask", name] as const)
        : (["info", "--json=v2", name] as const);
    const { stdout } = await execFileUtf8("brew", [...args], {
      ...(env === undefined ? {} : { env }),
      timeout: BREW_INFO_TIMEOUT_MS,
    });
    return parseBrewInfoVersion(stdout);
  } catch {
    return null;
  }
}

/** Core: remote API only (null on miss). Taps have no formulae.brew.sh entry. */
export async function fetchBrewLatest(
  name: string,
  env?: NodeJS.ProcessEnv,
  isCask?: boolean
): Promise<string | null> {
  if (!isBrewCoreToken(name)) {
    return fetchBrewLocalInfo(name, env, isCask);
  }
  const preferCask = isCask === true;
  const primary = await fetchBrewRemoteApi(name, preferCask, env);
  if (primary) {
    return primary;
  }
  const secondary = await fetchBrewRemoteApi(name, !preferCask, env);
  return secondary;
}
