import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_CODE_USAGE_SOURCE_ID,
  createClaudeCodeUsageScanner,
} from "./claude-code-scanner.ts";
import type {
  AgentUsageCollector,
  AgentUsageCollectorFactory,
} from "./types.ts";

/**
 * Claude Code (Anthropic CLI) 会话用量采集器。
 *
 * 数据源：`~/.claude/projects/<project-slug>/<sessionId>.jsonl`（子代理为
 * `agent-<agentId>.jsonl`）。CLI 追加式写入，30 天默认保留（`cleanupPeriodDays`
 * 用户可改）。宿主 collector 独立配一份增量缓存 + 每 rescan 覆盖窗口 31 天。
 *
 * 与 Codex 的关键差异：
 * - Claude Code 不按日期分片目录，改按 project + sessionId 分层，mtime 决定新旧。
 * - `message.usage` 是每次 API 调用的绝对值，不需 total-diff。
 * - 有 `cache_creation` / `cache_read` 双 cache 概念；映射策略见 parser 注释。
 */

function resolveClaudeProjectsRoot(env: NodeJS.ProcessEnv): string {
  const override = env.CLAUDE_HOME;
  if (override && override.length > 0) {
    return join(override, "projects");
  }
  return join(env.HOME ?? homedir(), ".claude", "projects");
}

export const createClaudeCodeUsageCollector: AgentUsageCollectorFactory = (
  context
): AgentUsageCollector => {
  const claudeProjectsRoot = resolveClaudeProjectsRoot(context.env);
  const cachePath = join(
    context.userDataDir,
    "usage-collectors",
    "claude-code-cache.json"
  );
  const scanner = createClaudeCodeUsageScanner({
    cachePath,
    claudeProjectsRoot,
  });
  return {
    agentId: "claude",
    detect: () => existsSync(claudeProjectsRoot),
    async rescan() {
      const result = await scanner.scan();
      if (result.diagnostics.failedFiles > 0) {
        context.logger.warn("claude-code usage scan had failed files", {
          failed: result.diagnostics.failedFiles,
          malformedLines: result.diagnostics.malformedLines,
          parsed: result.diagnostics.parsedFiles,
        });
      }
      if (result.input.observations.length === 0) return null;
      return result.input;
    },
    sourceId: CLAUDE_CODE_USAGE_SOURCE_ID,
  };
};
