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

function defaultHydratePath(): Promise<string[]> {
  const shell = process.env.SHELL ?? "/bin/sh";
  return new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", "echo $PATH"],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        const merged = mergeLoginShellPath(
          process.env.PATH ?? "",
          stdout.trim()
        );
        process.env.PATH = merged.path;
        resolve(merged.added);
      }
    );
  });
}

export interface AgentDetectionService {
  detect(): Promise<DetectAgentsResult>;
  /** 幂等补齐 login-shell PATH（memoized）。GUI 启动的 Electron PATH 缺用户 bin 目录，
   * 直接 spawn CLI 会 ENOENT；spawn 前 await 本方法即可保证 PATH 就绪。 */
  ensurePath(): Promise<void>;
  refresh(): Promise<DetectAgentsResult>;
}

export interface CreateAgentDetectionServiceArgs {
  hydratePath?: () => Promise<string[]>;
  probe?: (cmd: string) => Promise<boolean>;
}

export function createAgentDetectionService({
  hydratePath = defaultHydratePath,
  probe = probeCommand,
}: CreateAgentDetectionServiceArgs = {}): AgentDetectionService {
  let pathHydrated = false;
  let hydrateInFlight: Promise<string[]> | null = null;
  let cachedResult: DetectAgentsResult | null = null;
  let detectInFlight: Promise<DetectAgentsResult> | null = null;

  async function hydratePathOnce(): Promise<void> {
    if (pathHydrated) {
      return;
    }
    if (!hydrateInFlight) {
      hydrateInFlight = hydratePath()
        .then((added) => {
          pathHydrated = true;
          return added;
        })
        .finally(() => {
          hydrateInFlight = null;
        });
    }
    await hydrateInFlight;
  }

  async function hydratePathNow(): Promise<string[]> {
    const added = await hydratePath();
    pathHydrated = true;
    return added;
  }

  async function detect(): Promise<DetectAgentsResult> {
    await hydratePathOnce();
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
    ensurePath: hydratePathOnce,
    async refresh() {
      if (detectInFlight) {
        await detectInFlight;
      }
      const added = await hydratePathNow();
      cachedResult = null;
      const detectResult = await detect();
      return { ...detectResult, addedPathSegments: added };
    },
  };
}
