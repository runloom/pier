/**
 * CLI agent 一次性(非交互)文本生成:one-shot 参数在 agent catalog,
 * 启动命令复用 resolveAgentCommand(override/defaultArgs)。
 */
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";

export function supportsOneShot(agentId: AgentKind): boolean {
  return getAgentCatalogEntry(agentId)?.oneShotArgs !== undefined;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: 剥离终端 ANSI 转义序列需要匹配 ESC 控制符
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/**
 * agent CLI 的 stdout 可能混有 banner/日志(codex exec 尤甚),
 * 取最后一个非空行作为模型答案。
 */
export function extractAnswerLine(stdout: string): string {
  const lines = stdout
    .replace(ANSI_PATTERN, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1) ?? "";
}
