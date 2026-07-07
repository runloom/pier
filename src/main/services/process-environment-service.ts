import { spawn } from "node:child_process";
import { userInfo } from "node:os";

export type ProcessEnvironmentSource = "agent" | "plugin" | "task" | "terminal";
type Environment = Record<string, string>;
type RawEnvironment = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface ProcessEnvironmentResolveRequest {
  agentEnv?: Record<string, string> | undefined;
  clientEnv?: Record<string, string> | undefined;
  cwd?: string | undefined;
  explicitEnv?: Record<string, string> | undefined;
  profileEnv?: Record<string, string> | undefined;
  source: ProcessEnvironmentSource;
}

export interface ProcessEnvironmentDiagnostics {
  cacheHit: boolean;
  cwd?: string | undefined;
  error?: string | undefined;
  pathChanged: boolean;
  shell?: string | undefined;
  shellEnvStatus: "cached" | "failed" | "resolved" | "skipped";
  source: ProcessEnvironmentSource;
}

export interface ProcessEnvironmentResolveResult {
  diagnostics: ProcessEnvironmentDiagnostics;
  env: Environment;
}

export interface ShellEnvironmentLoadRequest {
  cwd?: string | undefined;
  shell: string;
  source: ProcessEnvironmentSource;
}

export interface ShellEnvironmentLoadResult {
  env: Environment;
  status: "resolved" | "skipped";
}

export type ShellEnvironmentLoader = (
  request: ShellEnvironmentLoadRequest
) => Promise<ShellEnvironmentLoadResult>;

export interface CreateProcessEnvironmentServiceOptions {
  baseEnv?: RawEnvironment;
  loadShellEnv?: ShellEnvironmentLoader;
  platform?: NodeJS.Platform;
  shell?: string | undefined;
  timeoutMs?: number;
}

export interface ProcessEnvironmentService {
  resolve(
    request: ProcessEnvironmentResolveRequest
  ): Promise<ProcessEnvironmentResolveResult>;
}

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHELL_ENV_START = "__PIER_ENV_START__";
const SHELL_ENV_END = "__PIER_ENV_END__";
const DEFAULT_TIMEOUT_MS = 10_000;

function cleanEnv(env: RawEnvironment | undefined): Environment {
  const entries = Object.entries(env ?? {}).filter(
    (entry): entry is [string, string] =>
      ENV_KEY_RE.test(entry[0]) && typeof entry[1] === "string"
  );
  return Object.fromEntries(entries);
}

function mergeEnv(...layers: Array<Environment | undefined>): Environment {
  return Object.assign({}, ...layers.map((layer) => cleanEnv(layer)));
}

function cacheKey({ cwd, shell, source }: ShellEnvironmentLoadRequest): string {
  return `${cwd ?? ""}\0${shell}\0${source}`;
}

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

function shellEnvCommand(): string {
  return [
    `printf '${SHELL_ENV_START}\\n'`,
    "/usr/bin/env -0",
    `printf '\\n${SHELL_ENV_END}\\n'`,
  ].join("; ");
}

function loadShellEnvironment({
  baseEnv,
  timeoutMs,
}: {
  baseEnv: Record<string, string>;
  timeoutMs: number;
}): ShellEnvironmentLoader {
  return ({ cwd, shell }) =>
    new Promise((resolve, reject) => {
      const child = spawn(shell, ["-lic", shellEnvCommand()], {
        cwd,
        env: baseEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      const finish = (value: ShellEnvironmentLoadResult) => {
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
      const timer = setTimeout(() => {
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
        if (code !== 0) {
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
        finish({
          env: parseShellEnvironmentOutput(Buffer.concat(stdout)),
          status: "resolved",
        });
      });
    });
}

function warnDiagnostics(diagnostics: ProcessEnvironmentDiagnostics): void {
  if (diagnostics.shellEnvStatus !== "failed") {
    return;
  }
  console.warn("[process-env] shell environment failed", {
    cwd: diagnostics.cwd,
    error: diagnostics.error,
    pathChanged: diagnostics.pathChanged,
    shell: diagnostics.shell,
    source: diagnostics.source,
  });
}

function defaultShell(platform: NodeJS.Platform): string | undefined {
  if (process.env.SHELL) {
    return process.env.SHELL;
  }
  try {
    const shell = userInfo().shell;
    if (shell) {
      return shell;
    }
  } catch {
    // 受限环境下 userInfo 可能失败，继续走平台兜底。
  }
  if (platform === "darwin") {
    return "/bin/zsh";
  }
  if (platform === "linux") {
    return "/bin/sh";
  }
}

export function createProcessEnvironmentService({
  baseEnv: rawBaseEnv = process.env,
  loadShellEnv,
  platform = process.platform,
  shell = defaultShell(platform),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CreateProcessEnvironmentServiceOptions = {}): ProcessEnvironmentService {
  const baseEnv = cleanEnv(rawBaseEnv);
  const shellLoader =
    loadShellEnv ?? loadShellEnvironment({ baseEnv, timeoutMs });
  const cache = new Map<string, Record<string, string>>();
  const inFlight = new Map<string, Promise<Record<string, string>>>();

  async function resolveShellEnv(
    request: ProcessEnvironmentResolveRequest
  ): Promise<{
    cacheHit: boolean;
    env: Record<string, string>;
    error?: string | undefined;
    shellEnvStatus: ProcessEnvironmentDiagnostics["shellEnvStatus"];
  }> {
    if (platform === "win32" || !shell) {
      return { cacheHit: false, env: {}, shellEnvStatus: "skipped" };
    }
    const key = cacheKey({ cwd: request.cwd, shell, source: request.source });
    const cached = cache.get(key);
    if (cached) {
      return { cacheHit: true, env: cached, shellEnvStatus: "cached" };
    }
    let pending = inFlight.get(key);
    if (!pending) {
      pending = shellLoader({
        cwd: request.cwd,
        shell,
        source: request.source,
      }).then((result) => {
        const env = result.status === "resolved" ? cleanEnv(result.env) : {};
        if (result.status === "resolved") {
          cache.set(key, env);
        }
        return env;
      });
      inFlight.set(key, pending);
    }
    try {
      const env = await pending;
      return { cacheHit: false, env, shellEnvStatus: "resolved" };
    } catch (error) {
      return {
        cacheHit: false,
        env: {},
        error: error instanceof Error ? error.message : String(error),
        shellEnvStatus: "failed",
      };
    } finally {
      inFlight.delete(key);
    }
  }

  return {
    async resolve(request) {
      const shellEnv = await resolveShellEnv(request);
      const env = mergeEnv(
        baseEnv,
        shellEnv.env,
        request.clientEnv,
        request.agentEnv,
        request.profileEnv,
        request.explicitEnv
      );
      const diagnostics: ProcessEnvironmentDiagnostics = {
        cacheHit: shellEnv.cacheHit,
        ...(request.cwd ? { cwd: request.cwd } : {}),
        ...(shellEnv.error ? { error: shellEnv.error } : {}),
        pathChanged: baseEnv.PATH !== env.PATH,
        ...(shell ? { shell } : {}),
        shellEnvStatus: shellEnv.shellEnvStatus,
        source: request.source,
      };
      warnDiagnostics(diagnostics);
      return { diagnostics, env };
    },
  };
}
