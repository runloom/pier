import { execFile } from "node:child_process";
import { platform } from "node:os";
import { AGENT_CATALOG } from "@shared/agent-catalog.ts";
import type { AgentKind, DetectAgentsResult } from "@shared/contracts/agent.ts";

const PROBE_TIMEOUT_MS = 5000;

/** 用 which/where 查命令是否在 PATH 上（不 spawn binary，避免副作用）。 */
function defaultProbe(cmd: string): Promise<boolean> {
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
        const current = new Set(
          (process.env.PATH ?? "").split(":").filter(Boolean)
        );
        const added = stdout
          .trim()
          .split(":")
          .filter((s) => s && !current.has(s));
        if (added.length > 0) {
          process.env.PATH = [...current, ...added].join(":");
        }
        resolve(added);
      }
    );
  });
}

export interface AgentDetectionService {
  detect(): Promise<DetectAgentsResult>;
  refresh(): Promise<DetectAgentsResult>;
}

export interface CreateAgentDetectionServiceArgs {
  hydratePath?: () => Promise<string[]>;
  probe?: (cmd: string) => Promise<boolean>;
}

export function createAgentDetectionService({
  hydratePath = defaultHydratePath,
  probe = defaultProbe,
}: CreateAgentDetectionServiceArgs = {}): AgentDetectionService {
  let pathHydrated = false;
  let hydrateInFlight: Promise<string[]> | null = null;

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
    const checks = await Promise.all(
      AGENT_CATALOG.map(async (entry) => {
        const cmds = [entry.detectCmd, ...(entry.detectCmdAliases ?? [])];
        const hits = await Promise.all(cmds.map((c) => probe(c)));
        return hits.some(Boolean) ? entry.id : null;
      })
    );
    const detectedIds = checks.filter((id): id is AgentKind => id !== null);
    return { detectedIds };
  }

  return {
    detect,
    async refresh() {
      const added = await hydratePathNow();
      const detectResult = await detect();
      return { ...detectResult, addedPathSegments: added };
    },
  };
}
