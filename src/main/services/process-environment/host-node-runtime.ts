/**
 * Host Node runtime — the single producer of "which node does Pier spawn with".
 *
 * Product fact, not shell-env internals: the version/path pair the user sees in
 * Settings → Terminal → Shell environment and in lifecycle failure copy.
 *
 * Never fold this into the login-shell dump command (`shellEnvJsonCommand`):
 * dump must stay a single-purpose env export.
 */
import { spawn } from "node:child_process";
import { resolveAbsoluteOnPath } from "./resolve-user-command-surface.ts";

export interface HostNodeRuntime {
  path: string;
  /** Normalized to a leading `v` (e.g. "v24.15.0"). */
  version: string;
}

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 30_000;
const VERSION_PATTERN = /^v?(\d+\.\d+\.\d+)/;

export interface HostNodeRuntimeProbeOptions {
  /** Read at probe time; default `process.env`. */
  env?: () => NodeJS.ProcessEnv;
  resolveOnPath?: (
    commandName: string,
    pathEnv: string | undefined
  ) => string | null;
  runVersion?: (
    path: string,
    timeoutMs: number,
    env?: NodeJS.ProcessEnv
  ) => Promise<string | null>;
  /** Version spawn budget (ms). */
  timeoutMs?: number;
  /** Success cache TTL (ms). */
  ttlMs?: number;
}

export interface HostNodeRuntimeProbe {
  clear(): void;
  probe(env?: NodeJS.ProcessEnv): Promise<HostNodeRuntime | null>;
}

function defaultRunVersion(
  path: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  let timer: NodeJS.Timeout | undefined;
  let stdout = "";
  const settle = (value: string | null): void => {
    clearTimeout(timer);
    timer = undefined;
    resolve(value);
  };

  // Class B: node --version probe after PATH overlay so mise/asdf/fnm shims resolve.
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(path, ["--version"], {
      ...(env ? { env } : {}),
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
  } catch {
    resolve(null);
    return promise;
  }
  timer = setTimeout(() => {
    child.kill();
    settle(null);
  }, timeoutMs);
  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdout += String(chunk);
  });
  child.on("error", () => {
    settle(null);
  });
  child.on("close", (code) => {
    settle(code === 0 ? stdout.trim() : null);
  });
  return promise;
}

export function createHostNodeRuntimeProbe(
  options: HostNodeRuntimeProbeOptions = {}
): HostNodeRuntimeProbe {
  const readEnv = options.env ?? (() => process.env);
  const resolveOnPath = options.resolveOnPath ?? resolveAbsoluteOnPath;
  const runVersion = options.runVersion ?? defaultRunVersion;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const negativeUntil = new Map<string, number>();
  let cached: { key: string; until: number; value: HostNodeRuntime } | null =
    null;

  return {
    clear() {
      cached = null;
      negativeUntil.clear();
    },

    async probe(env?: NodeJS.ProcessEnv): Promise<HostNodeRuntime | null> {
      try {
        const probeEnv = env ?? readEnv();
        const path = resolveOnPath("node", probeEnv.PATH);
        if (!path) {
          negativeUntil.set("", Date.now() + NEGATIVE_TTL_MS);
          return null;
        }
        const now = Date.now();
        if (cached?.key === path && cached.until > now) {
          return cached.value;
        }
        if ((negativeUntil.get(path) ?? 0) > now) {
          return null;
        }
        const raw = await runVersion(path, timeoutMs, probeEnv);
        const match = raw ? VERSION_PATTERN.exec(raw.trim()) : null;
        if (!match) {
          negativeUntil.set(path, Date.now() + NEGATIVE_TTL_MS);
          cached = null;
          return null;
        }
        const value: HostNodeRuntime = { path, version: `v${match[1]}` };
        cached = { key: path, until: Date.now() + ttlMs, value };
        negativeUntil.delete(path);
        return value;
      } catch {
        return null;
      }
    },
  };
}
