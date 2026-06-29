import { execFile } from "node:child_process";
import { platform } from "node:os";
import type { AgentKind, DetectAgentsResult } from "@shared/contracts/agent.ts";
import { AGENT_CATALOG } from "./agent-catalog.ts";

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

export interface AgentDetectionService {
  detect(): Promise<DetectAgentsResult>;
}

export interface CreateAgentDetectionServiceArgs {
  probe?: (cmd: string) => Promise<boolean>;
}

export function createAgentDetectionService({
  probe = defaultProbe,
}: CreateAgentDetectionServiceArgs = {}): AgentDetectionService {
  return {
    async detect() {
      const checks = await Promise.all(
        AGENT_CATALOG.map(async (entry) => {
          const cmds = [entry.detectCmd, ...(entry.detectCmdAliases ?? [])];
          const hits = await Promise.all(cmds.map((c) => probe(c)));
          return hits.some(Boolean) ? entry.id : null;
        })
      );
      const detectedIds = checks.filter((id): id is AgentKind => id !== null);
      return { detectedIds };
    },
  };
}
