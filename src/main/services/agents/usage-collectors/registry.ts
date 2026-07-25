import { createClaudeCodeUsageCollector } from "./claude-code.ts";
import { createClineUsageCollector } from "./cline.ts";
import { createCodexUsageCollector } from "./codex.ts";
import { createCopilotUsageCollector } from "./copilot.ts";
import { createCrushUsageCollector } from "./crush.ts";
import { createDroidUsageCollector } from "./droid.ts";
import { createGooseUsageCollector } from "./goose.ts";
import { createGrokUsageCollector } from "./grok.ts";
import { createHermesUsageCollector } from "./hermes.ts";
import { createKimiUsageCollector } from "./kimi.ts";
import { createKiroUsageCollector } from "./kiro.ts";
import { createOmpUsageCollector } from "./omp.ts";
import { createOpenCodeUsageCollector } from "./opencode.ts";
import { createPiUsageCollector } from "./pi.ts";
import { createQodercliUsageCollector } from "./qodercli.ts";
import type { AgentUsageCollectorFactory } from "./types.ts";

/**
 * 已接入的 agent usage collector 注册表（与 integrations/registry 对齐）。
 *
 * 覆盖矩阵（本机实证 2026-07）：
 *
 * | agentId   | 数据源 | 状态 |
 * |-----------|--------|------|
 * | codex     | ~/.codex/sessions jsonl token_count | ✅ |
 * | claude    | ~/.claude/projects jsonl message.usage | ✅ |
 * | opencode  | OpenCode JSON storage + SQLite | ✅ |
 * | pi / omp  | ~/.pi|~/.omp agent sessions jsonl | ✅ |
 * | grok      | ~/.grok/sessions updates.jsonl turn_completed | ✅ |
 * | kimi      | ~/.kimi wire.jsonl StatusUpdate.token_usage | ✅ |
 * | copilot   | ~/.copilot/session-state events shutdown.modelMetrics | ✅ |
 * | hermes    | ~/.hermes/state.db sessions | ✅ |
 * | goose     | ~/.local/share/goose sessions usage_ledger | ✅ |
 * | crush     | 项目 .crush/crush.db sessions | ✅ |
 * | cline     | ~/.cline/data/sessions metadata.usage | ✅ |
 * | droid     | ~/.factory/sessions *.settings.json tokenUsage | ✅ |
 * | qodercli  | ~/.qoder/logs/sessions model.response.completed | ✅ |
 * | kiro      | ~/.kiro/sessions json token counts（常为 0） | ✅ |
 *
 * 暂无稳定本机 token 日志（detect/hook 可能有，但无可靠用量字段）：
 * gemini（会话无 token）、cursor（transcript/store 无 token）、aider（已退役且无日志）、
 * amp / aug / autohand / antigravity / codebuddy / command-code / openclaude /
 * mistral-vibe / mimo-code / kilo / devin / continue / codebuff / ante / rovo /
 * openclaw / qwen-code（本机无会话目录）。
 * 上游一旦落盘结构化 usage，按本目录 pattern 加 parser + 本表一行即可。
 */
export const AGENT_USAGE_COLLECTOR_FACTORIES: readonly AgentUsageCollectorFactory[] =
  [
    createCodexUsageCollector,
    createClaudeCodeUsageCollector,
    createOpenCodeUsageCollector,
    createPiUsageCollector,
    createOmpUsageCollector,
    createGrokUsageCollector,
    createKimiUsageCollector,
    createCopilotUsageCollector,
    createHermesUsageCollector,
    createGooseUsageCollector,
    createCrushUsageCollector,
    createClineUsageCollector,
    createDroidUsageCollector,
    createQodercliUsageCollector,
    createKiroUsageCollector,
  ];
