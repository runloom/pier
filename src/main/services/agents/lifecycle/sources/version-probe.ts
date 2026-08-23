import { execFile } from "node:child_process";
import { extractVersionFromOutput } from "@shared/agent-lifecycle/version-compare.ts";

export const VERSION_TIMEOUT_MS = 8000;

export interface VersionProbeResult {
  error?: string;
  runnable: boolean;
  version: string | null;
}

interface ExecError extends Error {
  code?: string | number | null;
  stderr?: string;
  stdout?: string;
}

function execOutput(err: ExecError): string {
  return `${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message}`;
}

/**
 * Missing interpreter / dangling binary. Gatekeeper kills, timeouts, and
 * `--version` exiting 1 are not this — those still mean the file is installed.
 */
export function isMissingRuntimeError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as ExecError;
  if (e.code === "ENOENT" || e.code === 127) {
    return true;
  }
  return /bad interpreter|\/usr\/bin\/env:|\bnode: (?:command )?not found/i.test(
    execOutput(e)
  );
}

function execFileUtf8(
  file: string,
  args: readonly string[],
  options: {
    env?: NodeJS.ProcessEnv;
    timeout?: number;
  }
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
        const out = typeof stdout === "string" ? stdout : String(stdout ?? "");
        const errOut =
          typeof stderr === "string" ? stderr : String(stderr ?? "");
        if (err) {
          const wrapped = err as ExecError;
          wrapped.stdout = out;
          wrapped.stderr = errOut;
          reject(wrapped);
          return;
        }
        resolve({ stdout: out, stderr: errOut });
      }
    );
  });
}

/**
 * Best-effort version read. Presence on PATH is install success; this spawn
 * only fills `version`. Missing runtime → not runnable. Any other spawn
 * failure leaves the install intact with a null version.
 */
export async function readVersionAtPath(
  binPath: string,
  versionArgs: readonly string[],
  env?: NodeJS.ProcessEnv
): Promise<VersionProbeResult> {
  try {
    const { stdout, stderr } = await execFileUtf8(binPath, versionArgs, {
      ...(env === undefined ? {} : { env }),
      timeout: VERSION_TIMEOUT_MS,
    });
    return {
      runnable: true,
      version: extractVersionFromOutput(`${stdout}\n${stderr}`),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const text = err instanceof Error ? execOutput(err) : message;
    const version = extractVersionFromOutput(text);
    if (isMissingRuntimeError(err)) {
      return { error: message, runnable: false, version: null };
    }
    return { runnable: true, version };
  }
}
