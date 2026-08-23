import { execFile } from "node:child_process";
import { extractVersionFromOutput } from "@shared/agent-lifecycle/version-compare.ts";
import type { AgentLatestProbe } from "./specs/types.ts";

const HTTP_TIMEOUT_MS = 15_000;

const ALLOWED_LATEST_HOSTS = new Set([
  "cursor.com",
  "www.cursor.com",
  "downloads.claude.ai",
]);

const CURSOR_LAB_VERSION_RE =
  /https:\/\/downloads\.cursor\.com\/lab\/([^/\s"'\\]+)\//i;

function assertLatestProbeUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid latest URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Latest URL must be https: ${url}`);
  }
  if (!ALLOWED_LATEST_HOSTS.has(parsed.hostname)) {
    throw new Error(`Latest host not allowed: ${parsed.hostname}`);
  }
  return parsed;
}

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

async function curlText(
  url: string,
  env?: NodeJS.ProcessEnv
): Promise<string | null> {
  try {
    assertLatestProbeUrl(url);
    const { stdout } = await execFileUtf8("curl", ["-fsSL", url], {
      ...(env === undefined ? {} : { env }),
      timeout: HTTP_TIMEOUT_MS,
    });
    return stdout;
  } catch {
    return null;
  }
}

export async function fetchLatestProbe(
  probe: AgentLatestProbe,
  env?: NodeJS.ProcessEnv
): Promise<string | null> {
  const body = await curlText(probe.url, env);
  if (body === null) {
    return null;
  }
  if (probe.kind === "cursor-install-script") {
    return parseCursorInstallScriptVersion(body);
  }
  return parseHttpTextVersion(body);
}
