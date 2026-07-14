import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPiFamilyUsageScanner } from "./pi-family-scanner.ts";
import type {
  AgentUsageCollector,
  AgentUsageCollectorFactory,
} from "./types.ts";

/**
 * pi (earendil-works/pi) 会话用量采集器。
 *
 * 数据源：`~/.pi/agent/sessions/--<cwd-encoded>--/<timestamp>_<uuid>.jsonl`。
 * 会话为 pi-mono v3 tree JSONL 格式；共享 parser 见 `pi-family-parser.ts`。
 * omp 与 pi 是同族（omp fork 自 pi），采集逻辑仅 sessions root 不同。
 */

const PI_USAGE_SOURCE_ID = "pi-local-sessions";

function resolvePiSessionsRoot(env: NodeJS.ProcessEnv): string {
  const override = env.PI_HOME;
  if (override && override.length > 0) {
    return join(override, "agent", "sessions");
  }
  return join(env.HOME ?? homedir(), ".pi", "agent", "sessions");
}

export const createPiUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const sessionsRoot = resolvePiSessionsRoot(context.env);
  const cachePath = join(
    context.userDataDir,
    "usage-collectors",
    "pi-cache.json"
  );
  const scanner = createPiFamilyUsageScanner({
    cachePath,
    sessionsRoot,
    sourceId: PI_USAGE_SOURCE_ID,
  });
  return {
    agentId: "pi",
    detect: () => existsSync(sessionsRoot),
    async rescan() {
      const result = await scanner.scan();
      if (result.diagnostics.failedFiles > 0) {
        context.logger.warn("pi usage scan had failed files", {
          failed: result.diagnostics.failedFiles,
          malformedLines: result.diagnostics.malformedLines,
          parsed: result.diagnostics.parsedFiles,
        });
      }
      if (result.input.observations.length === 0) return null;
      return result.input;
    },
    sourceId: PI_USAGE_SOURCE_ID,
  };
};
