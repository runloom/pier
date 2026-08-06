import { execFile } from "node:child_process";
import { platform } from "node:os";
import { delimiter } from "node:path";
import { AGENT_CATALOG } from "@shared/agent-catalog.ts";
import type { DetectAgentsResult } from "@shared/contracts/agent.ts";
import {
  clearUserCommandResolveCache,
  resolveAbsoluteOnPath,
  resolveUserCommand,
} from "../process-environment/resolve-user-command.ts";

const PROBE_TIMEOUT_MS = 5000;
/** Cap interactive escalate concurrency (PATH miss only). */
const INTERACTIVE_ESCALATE_CONCURRENCY = 3;

function uniquePathSegments(value: string): string[] {
  const seen = new Set<string>();
  return value.split(delimiter).filter((segment) => {
    if (!segment || seen.has(segment)) {
      return false;
    }
    seen.add(segment);
    return true;
  });
}

/**
 * Pure PATH merge helper (tests / diagnostics only).
 * Product PATH hydration is owned by ProcessEnvironmentService + host apply.
 */
export function mergeLoginShellPath(
  currentPath: string,
  loginShellPath: string
): { added: string[]; path: string } {
  const current = uniquePathSegments(currentPath);
  const login = uniquePathSegments(loginShellPath);
  const currentSet = new Set(current);
  const loginSet = new Set(login);
  return {
    added: login.filter((segment) => !currentSet.has(segment)),
    path: [
      ...login,
      ...current.filter((segment) => !loginSet.has(segment)),
    ].join(delimiter),
  };
}

/** 用 which/where 查命令是否在 PATH 上（不 spawn binary，避免副作用）。 */
export function probeCommand(cmd: string): Promise<boolean> {
  return probeCommandWithEnv(cmd);
}

export interface AgentDetectionService {
  detect(): Promise<DetectAgentsResult>;
  /**
   * Wait until host shell env is ready (boot apply / PES).
   * Does **not** run a second `echo $PATH` dump.
   */
  ensurePath(): Promise<void>;
  refresh(): Promise<DetectAgentsResult>;
}

export interface CreateAgentDetectionServiceArgs {
  /**
   * Optional PES env for which/where (same as lifecycle). When set, probes use
   * this env instead of process defaults so detect matches lifecycle.
   */
  getEnv?: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
  /**
   * @deprecated Prefer waitForHostEnv. Kept for unit tests that simulate PATH
   * readiness before probe; never a product shell dump.
   */
  hydratePath?: () => Promise<string[]>;
  probe?: (cmd: string, env?: NodeJS.ProcessEnv) => Promise<boolean>;
  /**
   * Host shell env gate (hostShellEnvReady). Defaults to resolved no-op for tests.
   * Product wiring must inject the single boot Promise.
   */
  waitForHostEnv?: () => Promise<void>;
}

function whichProbe(cmd: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
  // Filesystem PATH walk first (no process).
  if (
    env &&
    typeof env.PATH === "string" &&
    resolveAbsoluteOnPath(cmd, env.PATH)
  ) {
    return Promise.resolve(true);
  }
  const binary = platform() === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    execFile(
      binary,
      [cmd],
      { timeout: PROBE_TIMEOUT_MS, env, windowsHide: true },
      (err, stdout) => {
        resolve(!err && stdout.trim().length > 0);
      }
    );
  });
}

/**
 * Product detect path:
 * 1) cheap PATH (`which` / walk)
 * 2) only on miss: interactive resolve (functions/aliases), concurrency-capped
 */
export function probeCommandWithEnv(
  cmd: string,
  env?: NodeJS.ProcessEnv
): Promise<boolean> {
  return (async () => {
    if (await whichProbe(cmd, env)) {
      return true;
    }
    if (platform() === "win32" || !env) {
      return false;
    }
    const stringEnv = Object.fromEntries(
      Object.entries(env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
    const resolved = await resolveUserCommand({
      commandName: cmd,
      env: stringEnv,
      shell: stringEnv.SHELL,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    return resolved.kind !== "missing";
  })();
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      results[index] = await worker(item);
    }
  }
  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    () => run()
  );
  await Promise.all(runners);
  return results;
}

export function createAgentDetectionService({
  hydratePath,
  getEnv,
  probe,
  waitForHostEnv,
}: CreateAgentDetectionServiceArgs = {}): AgentDetectionService {
  let cachedResult: DetectAgentsResult | null = null;
  let detectInFlight: Promise<DetectAgentsResult> | null = null;

  const probeImpl =
    probe ??
    ((cmd: string, env?: NodeJS.ProcessEnv) => probeCommandWithEnv(cmd, env));

  async function ready(): Promise<string[]> {
    if (waitForHostEnv) {
      await waitForHostEnv();
      return [];
    }
    if (hydratePath) {
      return await hydratePath();
    }
    return [];
  }

  async function detectOnce(): Promise<DetectAgentsResult> {
    const env = getEnv ? await getEnv() : undefined;

    // Collect unique command names across catalog.
    const names = new Set<string>();
    for (const entry of AGENT_CATALOG) {
      names.add(entry.detectCmd);
      for (const alias of entry.detectCmdAliases ?? []) {
        names.add(alias);
      }
    }
    const nameList = [...names];

    // Phase 1: cheap PATH for all names (no interactive shells).
    // Injected probe replaces which for tests/fakes (do not hit real PATH).
    const pathHits = new Set<string>();
    await Promise.all(
      nameList.map(async (name) => {
        if (probe) {
          if (await probeImpl(name, env)) {
            pathHits.add(name);
          }
          return;
        }
        if (await whichProbe(name, env)) {
          pathHits.add(name);
        }
      })
    );

    // Phase 2: interactive escalate only for PATH misses (capped concurrency).
    // Skip when a custom probe fully owns detection (tests inject that).
    const misses = nameList.filter((name) => !pathHits.has(name));
    const interactiveHits = new Set<string>();
    if (misses.length > 0 && !probe && platform() !== "win32" && env) {
      const stringEnv = Object.fromEntries(
        Object.entries(env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      );
      await mapPool(misses, INTERACTIVE_ESCALATE_CONCURRENCY, async (name) => {
        const resolved = await resolveUserCommand({
          commandName: name,
          env: stringEnv,
          shell: stringEnv.SHELL,
          timeoutMs: PROBE_TIMEOUT_MS,
        });
        if (resolved.kind !== "missing") {
          interactiveHits.add(name);
        }
      });
    }

    const present = (name: string) =>
      pathHits.has(name) || interactiveHits.has(name);

    const detectedIds = AGENT_CATALOG.filter((entry) => {
      const cmds = [entry.detectCmd, ...(entry.detectCmdAliases ?? [])];
      return cmds.some((c) => present(c));
    }).map((entry) => entry.id);

    return { detectedIds };
  }

  async function detect(): Promise<DetectAgentsResult> {
    await ready();
    if (cachedResult) {
      return cachedResult;
    }
    if (!detectInFlight) {
      detectInFlight = (async () => {
        cachedResult = await detectOnce();
        return cachedResult;
      })().finally(() => {
        detectInFlight = null;
      });
    }
    return await detectInFlight;
  }

  return {
    detect,
    ensurePath: async () => {
      await ready();
    },
    async refresh() {
      if (detectInFlight) {
        await detectInFlight;
      }
      const added = await ready();
      cachedResult = null;
      // Drop command-resolve cache so install → refresh sees new CLIs / functions.
      clearUserCommandResolveCache();
      const detectResult = await detect();
      return { ...detectResult, addedPathSegments: added };
    },
  };
}
