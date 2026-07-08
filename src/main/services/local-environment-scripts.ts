import type { ChildProcess, spawn as nodeSpawn } from "node:child_process";
import type { LocalEnvironmentProject } from "@shared/contracts/environment.ts";
import type { ProcessEnvironmentService } from "./process-environment-service.ts";

export type LocalEnvironmentLifecyclePhase = "setup" | "cleanup";

export class LocalEnvironmentScriptError extends Error {
  readonly exitCode: number | null;
  readonly phase: LocalEnvironmentLifecyclePhase;
  readonly stderr: string;
  readonly stdout: string;

  constructor(opts: {
    exitCode: number | null;
    message: string;
    phase: LocalEnvironmentLifecyclePhase;
    stderr: string;
    stdout: string;
  }) {
    super(opts.message);
    this.name = "LocalEnvironmentScriptError";
    this.exitCode = opts.exitCode;
    this.phase = opts.phase;
    this.stderr = opts.stderr;
    this.stdout = opts.stdout;
  }
}

export function isLocalEnvironmentScriptError(
  err: unknown
): err is LocalEnvironmentScriptError {
  if (err instanceof LocalEnvironmentScriptError) {
    return true;
  }
  return (
    err instanceof Error &&
    typeof (err as unknown as Record<string, unknown>).phase === "string" &&
    ("exitCode" in err || "stderr" in err)
  );
}

const LIFECYCLE_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

let defaultSpawnFn: typeof nodeSpawn | undefined;

function getDefaultSpawn(): typeof nodeSpawn {
  if (defaultSpawnFn) {
    return defaultSpawnFn;
  }
  // Lazy-load to avoid importing child_process at module level in tests.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const requiredSpawn = require("node:child_process").spawn as typeof nodeSpawn;
  defaultSpawnFn = requiredSpawn;
  return requiredSpawn;
}

function lifecycleCommand(
  project: LocalEnvironmentProject,
  phase: LocalEnvironmentLifecyclePhase
): string {
  return phase === "setup" ? project.setupCommand : project.cleanupCommand;
}

export async function runLocalEnvironmentLifecycle(request: {
  cwd: string;
  project: LocalEnvironmentProject;
  phase: LocalEnvironmentLifecyclePhase;
  processEnvironment: ProcessEnvironmentService;
  spawn?: typeof nodeSpawn;
}): Promise<void> {
  const command = lifecycleCommand(request.project, request.phase);
  if (!command.trim()) {
    return;
  }

  const resolved = await request.processEnvironment.resolve({
    cwd: request.cwd,
    explicitEnv: request.project.env,
    source: "terminal",
  });

  const platform = process.platform;
  let shell: string;
  let args: string[];
  if (platform === "win32") {
    shell = process.env.ComSpec ?? "cmd.exe";
    args = ["/d", "/s", "/c", command];
  } else {
    shell = resolved.env.SHELL ?? process.env.SHELL ?? "/bin/sh";
    args = ["-lc", command];
  }

  const spawn = request.spawn ?? getDefaultSpawn();

  return new Promise<void>((resolvePromise, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(shell, args, {
        cwd: request.cwd,
        env: resolved.env,
      });
    } catch (err) {
      reject(
        new LocalEnvironmentScriptError({
          exitCode: null,
          message: `local environment ${request.phase} script failed: spawn error`,
          phase: request.phase,
          stderr: String(err),
          stdout: "",
        })
      );
      return;
    }

    let stdoutBuf = "";
    let stderrBuf = "";
    let totalBytes = 0;
    let overflowed = false;

    const timeout = setTimeout(() => {
      child.kill();
      reject(
        new LocalEnvironmentScriptError({
          exitCode: null,
          message: `local environment ${request.phase} script failed: timeout after ${LIFECYCLE_TIMEOUT_MS}ms`,
          phase: request.phase,
          stderr: stderrBuf,
          stdout: stdoutBuf,
        })
      );
    }, LIFECYCLE_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      const str = String(chunk);
      totalBytes += chunk.length;
      if (totalBytes <= MAX_OUTPUT_BYTES) {
        stdoutBuf += str;
      } else if (!overflowed) {
        overflowed = true;
        child.kill();
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const str = String(chunk);
      totalBytes += chunk.length;
      if (totalBytes <= MAX_OUTPUT_BYTES) {
        stderrBuf += str;
      } else if (!overflowed) {
        overflowed = true;
        child.kill();
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(
        new LocalEnvironmentScriptError({
          exitCode: null,
          message: `local environment ${request.phase} script failed: ${err.message}`,
          phase: request.phase,
          stderr: stderrBuf,
          stdout: stdoutBuf,
        })
      );
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (overflowed) {
        reject(
          new LocalEnvironmentScriptError({
            exitCode: code,
            message: `local environment ${request.phase} script failed: output exceeded ${MAX_OUTPUT_BYTES} bytes`,
            phase: request.phase,
            stderr: stderrBuf,
            stdout: stdoutBuf,
          })
        );
        return;
      }
      if (code !== 0) {
        reject(
          new LocalEnvironmentScriptError({
            exitCode: code,
            message: `local environment ${request.phase} script failed`,
            phase: request.phase,
            stderr: stderrBuf,
            stdout: stdoutBuf,
          })
        );
        return;
      }
      resolvePromise();
    });
  });
}
