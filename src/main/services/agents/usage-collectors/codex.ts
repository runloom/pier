import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { codexHomeDir } from "../integrations/codex.ts";
import {
  CODEX_USAGE_SOURCE_ID,
  createCodexUsageScanner,
} from "./codex-scanner.ts";
import type {
  AgentUsageCollector,
  AgentUsageCollectorFactory,
} from "./types.ts";

/**
 * Codex CLI 会话用量采集器。数据源：`$CODEX_HOME` (默认 `~/.codex`) 下的
 * `sessions/**\/*.jsonl` + `archived_sessions/**\/*.jsonl`。会话 jsonl 里
 * `event_msg` 的 `token_count` 事件被抽出成规范化 observations。
 *
 * `codexHomeDir()` 与 hook integration 侧同源——保证 hook + collector
 * 看到的 codex home 是同一路径。
 */

export const createCodexUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const codexHome = codexHomeDir();
  const cachePath = join(
    context.userDataDir,
    "usage-collectors",
    "codex-cache.json"
  );
  const scanner = createCodexUsageScanner({ cachePath, codexHome });
  return {
    agentId: "codex",
    detect: () =>
      existsSync(codexHome) ||
      existsSync(join(homedir(), ".codex")) ||
      existsSync(join(homedir(), ".codex", "sessions")),
    async rescan() {
      const result = await scanner.scan();
      if (result.diagnostics.failedFiles > 0) {
        context.logger.warn("codex usage scan had failed files", {
          failed: result.diagnostics.failedFiles,
          malformedLines: result.diagnostics.malformedLines,
          parsed: result.diagnostics.parsedFiles,
        });
      }
      if (result.input.observations.length === 0) return null;
      return result.input;
    },
    sourceId: CODEX_USAGE_SOURCE_ID,
  };
};
