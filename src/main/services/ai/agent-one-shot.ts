/**
 * CLI agent 一次性(非交互)文本生成:one-shot 参数在 agent catalog,
 * 启动命令复用 resolveAgentCommand(override/defaultArgs)。
 */
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";

export function supportsOneShot(agentId: AgentKind): boolean {
  return getAgentCatalogEntry(agentId)?.oneShotArgs !== undefined;
}
