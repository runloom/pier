// Class B: latest-version probe over allowlisted hosts with host env (curl).
import { execFile } from "node:child_process";
import { extractVersionFromOutput } from "@shared/agent-lifecycle/version-compare.ts";
import { assertLatestHttpsUrl } from "./latest-hosts.ts";
import type { AgentLatestProbe } from "./specs/types.ts";

const HTTP_TIMEOUT_MS = 15_000;

const CURSOR_LAB_VERSION_RE =
  /https:\/\/downloads\.cursor\.com\/lab\/([^/\s"'\\]+)\//i;

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

export function parseCursorInstallScriptVersion(body: string): string | null {
  const match = CURSOR_LAB_VERSION_RE.exec(body);
  const version = match?.[1]?.trim();
  return version && version.length > 0 ? version : null;
}

export function parseHttpTextVersion(body: string): string | null {
  const line = body
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) {
    return null;
  }
  return extractVersionFromOutput(line);
}

/** GitHub Releases API: strip leading `v` from tag_name. */
export function parseGithubLatestReleaseVersion(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { tag_name?: string };
    const raw = parsed.tag_name?.trim();
    if (!raw) {
      return null;
    }
    const withoutV = raw.replace(/^v/i, "");
    return extractVersionFromOutput(withoutV) ?? withoutV;
  } catch {
    return null;
  }
}

async function curlText(
  url: string,
  env?: NodeJS.ProcessEnv
): Promise<string | null> {
  try {
    assertLatestHttpsUrl(url);
    const { stdout } = await execFileUtf8("curl", ["-fsSL", url], {
      ...(env === undefined ? {} : { env }),
      timeout: HTTP_TIMEOUT_MS,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Resolve which URL to hit for an http-text probe (Claude stable vs latest).
 */
export function resolveHttpTextProbeUrl(
  probe: Extract<AgentLatestProbe, { kind: "http-text" }>,
  channel?: "latest" | "stable" | null
): string {
  if (channel === "stable" && probe.stableUrl) {
    return probe.stableUrl;
  }
  return probe.url;
}

export async function fetchLatestProbe(
  probe: AgentLatestProbe,
  env?: NodeJS.ProcessEnv,
  options?: { httpChannel?: "latest" | "stable" | null }
): Promise<string | null> {
  if (probe.kind === "github-latest-release") {
    const body = await curlText(probe.url, env);
    if (body === null) {
      return null;
    }
    return parseGithubLatestReleaseVersion(body);
  }
  const url =
    probe.kind === "http-text"
      ? resolveHttpTextProbeUrl(probe, options?.httpChannel)
      : probe.url;
  const body = await curlText(url, env);
  if (body === null) {
    return null;
  }
  if (probe.kind === "cursor-install-script") {
    return parseCursorInstallScriptVersion(body);
  }
  return parseHttpTextVersion(body);
}
