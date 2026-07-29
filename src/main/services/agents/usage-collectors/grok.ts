import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveGrokHome, resolveGrokSessionsRoot } from "../grok-paths.ts";
import {
  createGrokUsageScanner,
  GROK_USAGE_SOURCE_ID,
} from "./grok-scanner.ts";
import type {
  AgentUsageCollector,
  AgentUsageCollectorFactory,
} from "./types.ts";

/**
 * Grok Build CLI 会话用量采集器。
 *
 * 数据源：`$GROK_HOME`（默认 `~/.grok`）下
 * `sessions/<encoded-cwd>/<sessionId>/updates.jsonl` 的 turn_completed usage。
 */

export const createGrokUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const sessionsRoot = resolveGrokSessionsRoot(context.env);
  const cachePath = join(
    context.userDataDir,
    "usage-collectors",
    "grok-cache.json"
  );
  const scanner = createGrokUsageScanner({ cachePath, sessionsRoot });
  return {
    agentId: "grok",
    detect: () =>
      existsSync(sessionsRoot) || existsSync(resolveGrokHome(context.env)),
    async rescan() {
      const result = await scanner.scan();
      if (result.diagnostics.failedFiles > 0) {
        context.logger.warn("grok usage scan had failed files", {
          failed: result.diagnostics.failedFiles,
          malformedLines: result.diagnostics.malformedLines,
          parsed: result.diagnostics.parsedFiles,
        });
      }
      if (result.input.observations.length === 0) return null;
      return result.input;
    },
    sourceId: GROK_USAGE_SOURCE_ID,
  };
};
