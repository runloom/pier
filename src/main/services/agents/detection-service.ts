import { execFile } from "node:child_process";
import { platform } from "node:os";
import { delimiter } from "node:path";
import { AGENT_CATALOG } from "@shared/agent-catalog.ts";
import type { AgentKind, DetectAgentsResult } from "@shared/contracts/agent.ts";

const PROBE_TIMEOUT_MS = 5000;

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
  const binary = platform() === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    execFile(binary, [cmd], { timeout: PROBE_TIMEOUT_MS }, (err, stdout) => {
      resolve(!err && stdout.trim().length > 0);
    });
  });
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
   * @deprecated Prefer waitForHostEnv. Kept for unit tests that simulate PATH
   * readiness before probe; never a product shell dump.
   */
  hydratePath?: () => Promise<string[]>;
  probe?: (cmd: string) => Promise<boolean>;
  /**
   * Host shell env gate (hostShellEnvReady). Defaults to resolved no-op for tests.
   * Product wiring must inject the single boot Promise.
   */
  waitForHostEnv?: () => Promise<void>;
}

export function createAgentDetectionService({
  hydratePath,
  probe = probeCommand,
  waitForHostEnv,
}: CreateAgentDetectionServiceArgs = {}): AgentDetectionService {
  let cachedResult: DetectAgentsResult | null = null;
  let detectInFlight: Promise<DetectAgentsResult> | null = null;

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

  async function detect(): Promise<DetectAgentsResult> {
    await ready();
    if (cachedResult) {
      return cachedResult;
    }
    if (!detectInFlight) {
      detectInFlight = Promise.all(
        AGENT_CATALOG.map(async (entry) => {
          const cmds = [entry.detectCmd, ...(entry.detectCmdAliases ?? [])];
          const hits = await Promise.all(cmds.map((c) => probe(c)));
          return hits.some(Boolean) ? entry.id : null;
        })
      )
        .then((checks) => {
          const detectedIds = checks.filter(
            (id): id is AgentKind => id !== null
          );
          cachedResult = { detectedIds };
          return cachedResult;
        })
        .finally(() => {
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
      const detectResult = await detect();
      return { ...detectResult, addedPathSegments: added };
    },
  };
}
