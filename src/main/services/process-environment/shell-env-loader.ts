import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { ENV_KEY_RE } from "./clean-env.ts";
import type {
  Environment,
  ShellEnvironmentLoader,
  ShellEnvironmentLoadResult,
} from "./types.ts";

/** Legacy env -0 markers (fallback parse if JSON mark dump is unavailable). */
export const SHELL_ENV_START = "__PIER_ENV_START__";
/** Legacy env -0 markers (fallback parse if JSON mark dump is unavailable). */
export const SHELL_ENV_END = "__PIER_ENV_END__";
export const PIER_RESOLVING_ENVIRONMENT = "PIER_RESOLVING_ENVIRONMENT";
export const DEFAULT_SHELL_ENV_TIMEOUT_MS = 10_000;

/**
 * Keys injected only for the dump spawn (JSON via Electron-as-node, re-entry guard).
 * Must not leak into task/agent/terminal resolve envs.
 */
export const SHELL_DUMP_ARTIFACT_KEYS = [
  "ELECTRON_NO_ATTACH_CONSOLE",
  "ELECTRON_RUN_AS_NODE",
  PIER_RESOLVING_ENVIRONMENT,
] as const;

/** Drop dump-only pollution after a successful parse (VS Code shellEnv does the same). */
export function stripShellDumpArtifacts(env: Environment): Environment {
  let changed = false;
  const next: Environment = { ...env };
  for (const key of SHELL_DUMP_ARTIFACT_KEYS) {
    if (key in next) {
      Reflect.deleteProperty(next, key);
      changed = true;
    }
  }
  return changed ? next : env;
}

function markerIndex(output: Buffer, marker: string, start = 0): number {
  return output.indexOf(Buffer.from(marker), start);
}

/** Legacy env -0 payload between fixed markers. */
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

/** Legacy env -0 command (tests / emergency fallback parsing). */
export function shellEnvCommand(): string {
  return [
    `printf '${SHELL_ENV_START}\\n'`,
    "/usr/bin/env -0",
    `printf '\\n${SHELL_ENV_END}\\n'`,
  ].join("; ");
}

/** Random mark for VS Code-style `mark{json}mark` dump. */
export function createShellEnvJsonMark(): string {
  return randomBytes(6).toString("hex");
}

/**
 * POSIX shell command: run Electron/Node as node and print
 * `mark + JSON.stringify(process.env) + mark` (matches VS Code shellEnv.ts).
 */
export function shellEnvJsonCommand(execPath: string, mark: string): string {
  const quotedPath = execPath.replaceAll("'", `'"'"'`);
  return `'${quotedPath}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse VS Code-style mark-wrapped JSON env from shell stdout. */
export function parseShellEnvironmentJsonOutput(
  output: Buffer | string,
  mark: string
): Environment {
  const raw = typeof output === "string" ? output : output.toString("utf8");
  // JSON.stringify is single-line; greedy match like VS Code shellEnv.ts.
  const regex = new RegExp(
    `${escapeRegExp(mark)}(\\{.*\\})${escapeRegExp(mark)}`
  );
  const match = regex.exec(raw);
  if (!match?.[1]) {
    throw new Error("shell environment json mark not found");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new Error("shell environment json mark payload is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("shell environment json mark payload is not an object");
  }
  const entries = Object.entries(parsed as Record<string, unknown>).flatMap(
    (entry): [string, string][] => {
      const [key, value] = entry;
      if (!(ENV_KEY_RE.test(key) && typeof value === "string")) {
        return [];
      }
      return [[key, value]];
    }
  );
  return Object.fromEntries(entries);
}

/**
 * Prefer a successful parse over exit status.
 * Try JSON-mark (primary) then legacy env -0 markers.
 */
export function tryParseShellEnvironmentOutput(
  output: Buffer,
  jsonMark?: string
): Environment | null {
  if (jsonMark) {
    try {
      return parseShellEnvironmentJsonOutput(output, jsonMark);
    } catch {
      // fall through to legacy markers
    }
  }
  try {
    return parseShellEnvironmentOutput(output);
  } catch {
    return null;
  }
}

/** Fallback floor after a timed-out primary so -c still gets a real attempt. */
export const FALLBACK_TIMEOUT_FLOOR_MS = 3000;

/**
 * Shared fallback deadline after primary fails.
 * Uses remaining primary budget when enough is left; otherwise grants a single
 * floor. Secondary and tertiary must share this deadline via remainingTimeoutMs
 * so total wall time stays at most ~totalTimeoutMs + one floor (not two).
 */
export function fallbackDeadlineMs(
  primaryDeadlineMs: number,
  totalTimeoutMs: number,
  now = Date.now()
): number {
  const remaining = primaryDeadlineMs - now;
  if (remaining > 500) {
    return primaryDeadlineMs;
  }
  return now + Math.min(FALLBACK_TIMEOUT_FLOOR_MS, Math.max(1, totalTimeoutMs));
}

/** Timeout slice from a shared fallback deadline (for tests / simple callers). */
export function fallbackTimeoutMs(
  deadlineMs: number,
  totalTimeoutMs: number,
  now = Date.now()
): number {
  return remainingTimeoutMs(
    fallbackDeadlineMs(deadlineMs, totalTimeoutMs, now),
    now
  );
}

function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Node reports `spawn /bin/zsh ENOENT` when *cwd* is missing, not only when the
 * shell binary is missing. Prefer an existing directory; otherwise omit cwd so
 * spawn uses the main process working directory.
 */
export function resolveShellDumpCwd(
  cwd: string | undefined,
  fallbackHome?: string | undefined
): string | undefined {
  for (const candidate of [cwd, fallbackHome]) {
    if (
      typeof candidate === "string" &&
      candidate.length > 0 &&
      isExistingDirectory(candidate)
    ) {
      return candidate;
    }
  }
  return;
}

/** Clarify ENOENT: missing shell vs missing working directory (Node conflates). */
export function formatShellSpawnError(
  error: unknown,
  shell: string,
  cwd: string | undefined
): Error {
  if (!(error instanceof Error)) {
    return new Error(String(error));
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== "ENOENT") {
    return error;
  }
  let shellMissing = false;
  try {
    accessSync(shell, constants.F_OK);
  } catch {
    shellMissing = true;
  }
  if (shellMissing) {
    return new Error(`shell not found: ${shell}`);
  }
  if (cwd && !isExistingDirectory(cwd)) {
    return new Error(
      `working directory not found: ${cwd} (Node reported spawn ${shell} ENOENT)`
    );
  }
  return error;
}

function runShellDump({
  args,
  baseEnv,
  cwd,
  jsonMark,
  shell,
  timeoutMs,
}: {
  args: string[];
  baseEnv: Record<string, string>;
  cwd?: string | undefined;
  jsonMark: string;
  shell: string;
  timeoutMs: number;
}): Promise<Environment> {
  return new Promise((resolve, reject) => {
    // Never pass a missing cwd — that yields a misleading "spawn shell ENOENT".
    const spawnCwd = resolveShellDumpCwd(cwd, baseEnv.HOME);
    const child = spawn(shell, args, {
      ...(spawnCwd ? { cwd: spawnCwd } : {}),
      env: {
        ...baseEnv,
        ELECTRON_NO_ATTACH_CONSOLE: "1",
        ELECTRON_RUN_AS_NODE: "1",
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
      resolve(stripShellDumpArtifacts(value));
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
      const parsed = tryParseShellEnvironmentOutput(
        collectedStdout(),
        jsonMark
      );
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
    child.on("error", (error) => {
      fail(formatShellSpawnError(error, shell, spawnCwd ?? cwd));
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      const buf = collectedStdout();
      const parsed = tryParseShellEnvironmentOutput(buf, jsonMark);
      if (parsed) {
        // Accept dump even when shell exit !== 0 (rc noise / zle / last status).
        finish(parsed);
        return;
      }
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
      fail(new Error("shell environment dump markers not found"));
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
  execPath = process.execPath,
  getTimeoutMs,
}: {
  baseEnv: Record<string, string>;
  /** Electron/Node binary used for JSON env dump (defaults to process.execPath). */
  execPath?: string;
  getTimeoutMs: () => number;
}): ShellEnvironmentLoader {
  return async ({ cwd, shell }) => {
    const totalTimeoutMs = getTimeoutMs();
    const deadlineMs = Date.now() + totalTimeoutMs;
    const startedAt = Date.now();
    const mark = createShellEnvJsonMark();
    const jsonCommand = shellEnvJsonCommand(execPath, mark);
    const finishOk = (
      env: Environment,
      dumpMode: "login-interactive" | "non-login-fallback"
    ): ShellEnvironmentLoadResult => ({
      dumpMode,
      durationMs: Date.now() - startedAt,
      env,
      status: "resolved",
    });
    const failWithDuration = (error: unknown): never => {
      const err = error instanceof Error ? error : new Error(String(error));
      (err as Error & { durationMs?: number }).durationMs =
        Date.now() - startedAt;
      throw err;
    };

    // 1) VS Code-style JSON dump via login-interactive shell.
    try {
      const env = await runShellDump({
        args: ["-lic", jsonCommand],
        baseEnv,
        cwd,
        jsonMark: mark,
        shell,
        timeoutMs: remainingTimeoutMs(deadlineMs),
      });
      return finishOk(env, "login-interactive");
    } catch (primaryError) {
      // One shared fallback budget (single floor, not per attempt).
      const fbDeadlineMs = fallbackDeadlineMs(deadlineMs, totalTimeoutMs);
      // 2) Non-login JSON dump (fish / broken -lic / partial timeout).
      try {
        const env = await runShellDump({
          args: ["-c", jsonCommand],
          baseEnv,
          cwd,
          jsonMark: mark,
          shell,
          timeoutMs: remainingTimeoutMs(fbDeadlineMs),
        });
        return finishOk(env, "non-login-fallback");
      } catch {
        // 3) Last resort: legacy env -0 (no Electron re-entry).
        try {
          const env = await runShellDump({
            args: ["-c", shellEnvCommand()],
            baseEnv,
            cwd,
            jsonMark: mark,
            shell,
            timeoutMs: remainingTimeoutMs(fbDeadlineMs),
          });
          return finishOk(env, "non-login-fallback");
        } catch {
          return failWithDuration(primaryError);
        }
      }
    }
  };
}
