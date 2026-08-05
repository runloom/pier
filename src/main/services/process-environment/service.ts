import { userInfo } from "node:os";
import { createLogger } from "@shared/logger.ts";
import { applyHostProcessEnv } from "./apply-host-env.ts";
import { cleanEnv, mergeEnv } from "./clean-env.ts";
import { clearUserCommandResolveCache } from "./resolve-user-command.ts";
import {
  createDefaultShellEnvironmentLoader,
  DEFAULT_SHELL_ENV_TIMEOUT_MS,
} from "./shell-env-loader.ts";
import type {
  CreateProcessEnvironmentServiceOptions,
  Environment,
  ProcessEnvironmentDiagnostics,
  ProcessEnvironmentResolveRequest,
  ProcessEnvironmentResolveResult,
  ProcessEnvironmentService,
  ShellEnvDumpMode,
  ShellEnvironmentLoadRequest,
} from "./types.ts";

export type {
  CreateProcessEnvironmentServiceOptions,
  ProcessEnvironmentService,
} from "./types.ts";

const log = createLogger("process-env");
const NEGATIVE_CACHE_TTL_MS = 30_000;

interface NegativeCacheEntry {
  error: string;
  until: number;
}

interface ResolvedShellLayer {
  cacheHit: boolean;
  dumpMode?: ShellEnvDumpMode | undefined;
  env: Environment;
  error?: string | undefined;
  shellEnvStatus: ProcessEnvironmentDiagnostics["shellEnvStatus"];
}

function cacheKey(cwd: string | undefined, shell: string): string {
  return `${cwd ?? ""}\0${shell}`;
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
    // Restricted environments may fail userInfo; fall through to platform default.
  }
  if (platform === "darwin") {
    return "/bin/zsh";
  }
  if (platform === "linux") {
    return "/bin/sh";
  }
}

function warnDiagnostics(diagnostics: ProcessEnvironmentDiagnostics): void {
  if (diagnostics.shellEnvStatus !== "failed") {
    return;
  }
  // Structured log → diagnostics jsonl (console.warn was invisible in support).
  log.warn("shell environment failed", {
    cwd: diagnostics.cwd,
    dumpMode: diagnostics.dumpMode,
    error: diagnostics.error,
    pathChanged: diagnostics.pathChanged,
    shell: diagnostics.shell,
    source: diagnostics.source,
  });
}

export function createProcessEnvironmentService({
  baseEnv: rawBaseEnv = process.env,
  getTimeoutMs,
  isDisabled,
  loadShellEnv,
  onShellEnvFailed,
  platform = process.platform,
  shell = defaultShell(platform),
  timeoutMs = DEFAULT_SHELL_ENV_TIMEOUT_MS,
}: CreateProcessEnvironmentServiceOptions = {}): ProcessEnvironmentService {
  const baseEnv = cleanEnv(rawBaseEnv);
  const resolveTimeoutMs = () => getTimeoutMs?.() ?? timeoutMs;
  const shellLoader =
    loadShellEnv ??
    createDefaultShellEnvironmentLoader({
      baseEnv,
      getTimeoutMs: resolveTimeoutMs,
    });

  const successCache = new Map<string, Environment>();
  const negativeCache = new Map<string, NegativeCacheEntry>();
  const inFlight = new Map<string, Promise<ResolvedShellLayer>>();
  let hostDiagnostics: ProcessEnvironmentDiagnostics | undefined;
  let lastAppliedKeys = new Set<string>();
  let applyChain: Promise<void> = Promise.resolve();
  /** Bumped on invalidate so in-flight dumps cannot repopulate caches/notify. */
  let generation = 0;

  function runSerializedApply(task: () => void): Promise<void> {
    const next = applyChain.then(() => {
      task();
    });
    applyChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  async function loadShellLayer(
    request: ProcessEnvironmentResolveRequest,
    key: string,
    loadGeneration: number
  ): Promise<ResolvedShellLayer> {
    const loadRequest: ShellEnvironmentLoadRequest = {
      cwd: request.cwd,
      shell: shell as string,
      source: request.source,
    };
    try {
      const result = await shellLoader(loadRequest);
      if (loadGeneration !== generation) {
        // Superseded by invalidate — do not write caches or notify.
        return { cacheHit: false, env: {}, shellEnvStatus: "skipped" };
      }
      const env = result.status === "resolved" ? cleanEnv(result.env) : {};
      if (result.status === "resolved") {
        successCache.set(key, env);
        negativeCache.delete(key);
        return {
          cacheHit: false,
          dumpMode: result.dumpMode,
          env,
          shellEnvStatus: "resolved",
        };
      }
      return { cacheHit: false, env: {}, shellEnvStatus: "skipped" };
    } catch (error) {
      if (loadGeneration !== generation) {
        return { cacheHit: false, env: {}, shellEnvStatus: "skipped" };
      }
      const message = error instanceof Error ? error.message : String(error);
      negativeCache.set(key, {
        error: message,
        until: Date.now() + NEGATIVE_CACHE_TTL_MS,
      });
      const failedLayer: ResolvedShellLayer = {
        cacheHit: false,
        env: {},
        error: message,
        shellEnvStatus: "failed",
      };
      // Notify once per real dump failure (not per concurrent waiter / resolve).
      if (onShellEnvFailed) {
        const provisional = buildDiagnostics(
          request,
          failedLayer,
          mergeEnv(
            baseEnv,
            request.clientEnv,
            request.agentEnv,
            request.profileEnv,
            request.projectEnv,
            request.explicitEnv
          )
        );
        onShellEnvFailed(provisional);
      }
      return failedLayer;
    }
  }

  async function resolveShellEnv(
    request: ProcessEnvironmentResolveRequest
  ): Promise<ResolvedShellLayer> {
    if (platform === "win32" || !shell) {
      return { cacheHit: false, env: {}, shellEnvStatus: "skipped" };
    }
    if (isDisabled?.()) {
      return { cacheHit: false, env: {}, shellEnvStatus: "skipped" };
    }

    const key = cacheKey(request.cwd, shell);
    const cached = successCache.get(key);
    if (cached) {
      return { cacheHit: true, env: cached, shellEnvStatus: "cached" };
    }

    const negative = negativeCache.get(key);
    if (negative && negative.until > Date.now()) {
      return {
        cacheHit: true,
        env: {},
        error: negative.error,
        shellEnvStatus: "failed",
      };
    }
    if (negative) {
      negativeCache.delete(key);
    }

    const loadGeneration = generation;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = loadShellLayer(request, key, loadGeneration).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, pending);
    }

    return await pending;
  }

  function buildDiagnostics(
    request: ProcessEnvironmentResolveRequest,
    shellEnv: ResolvedShellLayer,
    env: Environment
  ): ProcessEnvironmentDiagnostics {
    const hostAppliedStatus =
      shellEnv.shellEnvStatus === "failed" &&
      hostDiagnostics?.hostAppliedStatus === "applied"
        ? "stale-after-fail"
        : hostDiagnostics?.hostAppliedStatus;

    return {
      cacheHit: shellEnv.cacheHit,
      ...(request.cwd ? { cwd: request.cwd } : {}),
      ...(shellEnv.dumpMode ? { dumpMode: shellEnv.dumpMode } : {}),
      ...(shellEnv.error ? { error: shellEnv.error } : {}),
      ...(hostAppliedStatus ? { hostAppliedStatus } : {}),
      pathChanged: baseEnv.PATH !== env.PATH,
      ...(shell ? { shell } : {}),
      shellEnvStatus: shellEnv.shellEnvStatus,
      source: request.source,
    };
  }

  async function resolve(
    request: ProcessEnvironmentResolveRequest
  ): Promise<ProcessEnvironmentResolveResult> {
    const shellLayer = await resolveShellEnv(request);
    const env = mergeEnv(
      baseEnv,
      shellLayer.env,
      request.clientEnv,
      request.agentEnv,
      request.profileEnv,
      request.projectEnv,
      request.explicitEnv
    );
    const diagnostics = buildDiagnostics(request, shellLayer, env);
    warnDiagnostics(diagnostics);
    return {
      diagnostics,
      env,
      shellEnv: shellLayer.env,
    };
  }

  return {
    getHostDiagnostics() {
      return hostDiagnostics;
    },

    async invalidate(opts) {
      generation += 1;
      successCache.clear();
      negativeCache.clear();
      inFlight.clear();
      clearUserCommandResolveCache();
      if (!(opts?.reapplyHost && shell) || platform === "win32") {
        return hostDiagnostics;
      }
      const home =
        process.env.HOME ??
        (() => {
          try {
            return userInfo().homedir;
          } catch {
            return;
          }
        })();
      const result = await resolve({
        ...(home ? { cwd: home } : {}),
        source: "plugin",
      });
      await runSerializedApply(() => {
        const applied = applyHostProcessEnv(
          {
            diagnostics: result.diagnostics,
            shellEnv: result.shellEnv,
          },
          {
            lastAppliedKeys,
            mode: "replace-whitelist",
          }
        );
        lastAppliedKeys = applied.lastAppliedKeys;
        hostDiagnostics = {
          ...result.diagnostics,
          ...applied.diagnosticsPatch,
        };
      });
      return hostDiagnostics;
    },

    recordHostDiagnostics(diagnostics) {
      hostDiagnostics = diagnostics;
    },

    resolve,
  };
}

/** Test helper: wrap a resolve fn into a full service surface. */
export function stubProcessEnvironmentService(
  resolve: ProcessEnvironmentService["resolve"]
): ProcessEnvironmentService {
  return {
    getHostDiagnostics: () => undefined,
    invalidate: async () => undefined,
    recordHostDiagnostics: () => undefined,
    resolve,
  };
}
