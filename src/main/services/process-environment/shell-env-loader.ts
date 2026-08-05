import { spawn } from "node:child_process";
import { ENV_KEY_RE } from "./clean-env.ts";
import type {
  Environment,
  ShellEnvironmentLoader,
  ShellEnvironmentLoadResult,
} from "./types.ts";

export const SHELL_ENV_START = "__PIER_ENV_START__";
export const SHELL_ENV_END = "__PIER_ENV_END__";
export const PIER_RESOLVING_ENVIRONMENT = "PIER_RESOLVING_ENVIRONMENT";
export const DEFAULT_SHELL_ENV_TIMEOUT_MS = 10_000;

function markerIndex(output: Buffer, marker: string, start = 0): number {
  return output.indexOf(Buffer.from(marker), start);
}

export function parseShellEnvironmentOutput(output: Buffer): Environment {
  const startMarkerIndex = markerIndex(output, SHELL_ENV_START);
  if (startMarkerIndex < 0) {
    throw new Error("shell environment start marker not found");
  }
  const envStart = startMarkerIndex + SHELL_ENV_START.length + 1;
  const endMarkerIndex = markerIndex(output, `\n${SHELL_ENV_END}`, envStart);
  if (endMarkerIndex < 0) {
    throw new Error("shell environment end marker not found");
  }
  const envSection = output.subarray(envStart, endMarkerIndex);
  const entries = envSection
    .toString("utf8")
    .split("\0")
    .flatMap((entry): [string, string][] => {
      if (entry.length === 0) {
        return [];
      }
      const separator = entry.indexOf("=");
      const key = separator >= 0 ? entry.slice(0, separator) : entry;
      if (!(separator > 0 && ENV_KEY_RE.test(key))) {
        return [];
      }
      return [[key, entry.slice(separator + 1)]];
    });
  return Object.fromEntries(entries);
}

export function shellEnvCommand(): string {
  return [
    `printf '${SHELL_ENV_START}\\n'`,
    "/usr/bin/env -0",
    `printf '\\n${SHELL_ENV_END}\\n'`,
  ].join("; ");
}

/**
 * Prefer a successful marker parse over exit status.
 * Interactive shells often leave non-zero status (setopt/zle noise, last
 * pipeline in rc) even after env -0 printed cleanly — rejecting that caused
 * false "无法加载 shell 环境" toasts on otherwise good dumps.
 */
export function tryParseShellEnvironmentOutput(
  output: Buffer
): Environment | null {
  try {
    return parseShellEnvironmentOutput(output);
  } catch {
    return null;
  }
}

/** Fallback floor after a timed-out primary so -c still gets a real attempt. */
export const FALLBACK_TIMEOUT_FLOOR_MS = 3000;

/**
 * Primary shares the overall deadline. If almost nothing remains (typical after
 * -lic timeout), give fallback a short independent floor so fish / broken -lic
 * and "hung after dump" cases can still recover via -c.
 */
export function fallbackTimeoutMs(
  deadlineMs: number,
  totalTimeoutMs: number,
  now = Date.now()
): number {
  const remaining = remainingTimeoutMs(deadlineMs, now);
  if (remaining > 500) {
    return remaining;
  }
  return Math.min(FALLBACK_TIMEOUT_FLOOR_MS, Math.max(1, totalTimeoutMs));
}

function runShellDump({
  args,
  baseEnv,
  cwd,
  shell,
  timeoutMs,
}: {
  args: string[];
  baseEnv: Record<string, string>;
  cwd?: string | undefined;
  shell: string;
  timeoutMs: number;
}): Promise<Environment> {
  return new Promise((resolve, reject) => {
    const child = spawn(shell, args, {
      cwd,
      env: {
        ...baseEnv,
        [PIER_RESOLVING_ENVIRONMENT]: "1",
        TERM: baseEnv.TERM ?? "dumb",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const finish = (value: Environment) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const collectedStdout = () => Buffer.concat(stdout);
    const timer = setTimeout(() => {
      // Hang after dump is common; parse whatever we already have before kill.
      const parsed = tryParseShellEnvironmentOutput(collectedStdout());
      if (parsed) {
        child.kill();
        finish(parsed);
        return;
      }
      child.kill();
      fail(new Error(`shell environment timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      const buf = collectedStdout();
      try {
        // Accept dump even when shell exit !== 0 (rc noise / zle / last status).
        finish(parseShellEnvironmentOutput(buf));
        return;
      } catch (parseError) {
        if (code !== 0 && code !== null) {
          const message = Buffer.concat(stderr).toString("utf8").trim();
          fail(
            new Error(
              message
                ? `shell environment exited with ${code}: ${message}`
                : `shell environment exited with ${code}`
            )
          );
          return;
        }
        fail(
          parseError instanceof Error
            ? parseError
            : new Error(String(parseError))
        );
      }
    });
  });
}

/** Remaining ms until deadline; at least 1 so spawn still gets a real timer. */
export function remainingTimeoutMs(
  deadlineMs: number,
  now = Date.now()
): number {
  return Math.max(1, deadlineMs - now);
}

export function createDefaultShellEnvironmentLoader({
  baseEnv,
  getTimeoutMs,
}: {
  baseEnv: Record<string, string>;
  getTimeoutMs: () => number;
}): ShellEnvironmentLoader {
  return async ({ cwd, shell }) => {
    const totalTimeoutMs = getTimeoutMs();
    const deadlineMs = Date.now() + totalTimeoutMs;
    const command = shellEnvCommand();
    try {
      const env = await runShellDump({
        args: ["-lic", command],
        baseEnv,
        cwd,
        shell,
        timeoutMs: remainingTimeoutMs(deadlineMs),
      });
      return {
        dumpMode: "login-interactive",
        env,
        status: "resolved",
      } satisfies ShellEnvironmentLoadResult;
    } catch (primaryError) {
      // fish / nushell / broken or timed-out -lic: one non-login fallback dump.
      try {
        const env = await runShellDump({
          args: ["-c", command],
          baseEnv,
          cwd,
          shell,
          timeoutMs: fallbackTimeoutMs(deadlineMs, totalTimeoutMs),
        });
        return {
          dumpMode: "non-login-fallback",
          env,
          status: "resolved",
        } satisfies ShellEnvironmentLoadResult;
      } catch {
        throw primaryError instanceof Error
          ? primaryError
          : new Error(String(primaryError));
      }
    }
  };
}
