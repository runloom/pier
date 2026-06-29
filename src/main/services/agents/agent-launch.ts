import { platform } from "node:os";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentDefaultArgs, AgentKind } from "@shared/contracts/agent.ts";

export interface ResolveAgentCommandArgs {
  /** preferences.agentDefaultArgs。 */
  agentDefaultArgs: AgentDefaultArgs;
  agentId: AgentKind;
  /** terminal-profile 里的 binary 覆盖（可选）。 */
  override?: string | undefined;
}

/**
 * agentId → 启动命令字符串。args 视为 shell-ready 片段直接拼接
 * （与 terminal-profile.command 同构）。未知 agent 返回 null。
 */
export function resolveAgentCommand({
  agentId,
  override,
  agentDefaultArgs,
}: ResolveAgentCommandArgs): string | null {
  const entry = getAgentCatalogEntry(agentId);
  if (!entry) {
    return null;
  }
  const base =
    override?.trim() ||
    entry.launchCmdByPlatform?.[platform()] ||
    entry.launchCmd;
  const args = agentDefaultArgs[agentId]?.trim() ?? "";
  return args ? `${base} ${args}` : base;
}
