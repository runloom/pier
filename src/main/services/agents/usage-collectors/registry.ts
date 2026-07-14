import { createClaudeCodeUsageCollector } from "./claude-code.ts";
import { createCodexUsageCollector } from "./codex.ts";
import { createOmpUsageCollector } from "./omp.ts";
import { createOpenCodeUsageCollector } from "./opencode.ts";
import { createPiUsageCollector } from "./pi.ts";
import type { AgentUsageCollectorFactory } from "./types.ts";

/**
 * 已接入的 agent usage collector 注册表。跟 `integrations/registry.ts` 同构：
 * 每个 agent 一个模块 + 此处一行。新增 agent 的会话用量采集只需：
 *   1. 新增 `<agent-id>-parser.ts` / `<agent-id>-scanner.ts` / `<agent-id>.ts`
 *      三件套（parser 抽 jsonl，scanner 组装 publish 输入，collector 是 factory）。
 *   2. 在此数组追加 `create<Agent>UsageCollector`。
 *   3. Runner 会自动 registerBuiltInSource 并接入统一 refresh 通道。
 *
 * 已覆盖：Codex CLI、Claude Code、pi、omp（oh-my-pi）、OpenCode（v1.2.0+
 * SQLite 存储走 `node:sqlite`；v1.2.0 之前 JSON storage 走文件扫描；两侧
 * 结果由 collector 合并去重）。
 *
 * 未接入的 agent（Gemini CLI、Cursor、Copilot、Aider 等）：会话数据格式演进中
 * 或非结构化，暂无稳定 spec；等上游明确后按同一 pattern 添加。
 */
export const AGENT_USAGE_COLLECTOR_FACTORIES: readonly AgentUsageCollectorFactory[] =
  [
    createCodexUsageCollector,
    createClaudeCodeUsageCollector,
    createOpenCodeUsageCollector,
    createPiUsageCollector,
    createOmpUsageCollector,
  ];
