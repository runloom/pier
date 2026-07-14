import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPiFamilyUsageScanner } from "./pi-family-scanner.ts";
import type {
  AgentUsageCollector,
  AgentUsageCollectorFactory,
} from "./types.ts";

/**
 * omp (oh-my-pi) 会话用量采集器。
 *
 * 数据源：`~/.omp/agent/sessions/<dir-encoded>/<timestamp>_<sessionId>.jsonl`。
 * omp 是 pi 的 fork，会话 JSONL 格式一致，parser 复用 `pi-family-parser.ts`。
 * 唯一差异是 sessions root 路径。
 */

const OMP_USAGE_SOURCE_ID = "omp-local-sessions";

function resolveOmpSessionsRoot(env: NodeJS.ProcessEnv): string {
  const override = env.OMP_HOME;
  if (override && override.length > 0) {
    return join(override, "agent", "sessions");
  }
  return join(env.HOME ?? homedir(), ".omp", "agent", "sessions");
}

export const createOmpUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const sessionsRoot = resolveOmpSessionsRoot(context.env);
  const cachePath = join(
    context.userDataDir,
    "usage-collectors",
    "omp-cache.json"
  );
  const scanner = createPiFamilyUsageScanner({
    cachePath,
    sessionsRoot,
    sourceId: OMP_USAGE_SOURCE_ID,
  });
  return {
    agentId: "omp",
    detect: () => existsSync(sessionsRoot),
    async rescan() {
      const result = await scanner.scan();
      if (result.diagnostics.failedFiles > 0) {
        context.logger.warn("omp usage scan had failed files", {
          failed: result.diagnostics.failedFiles,
          malformedLines: result.diagnostics.malformedLines,
          parsed: result.diagnostics.parsedFiles,
        });
      }
      if (result.input.observations.length === 0) return null;
      return result.input;
    },
    sourceId: OMP_USAGE_SOURCE_ID,
  };
};
